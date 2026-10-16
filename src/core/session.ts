import type {
  CapturedFrame,
  Progress,
  RenderDestination,
  RenderJob,
  SessionOptions,
} from "./types.js";
export function validateJob(job: RenderJob): void {
  for (const key of ["width", "height", "startFrame", "endFrame"] as const) {
    if (
      !Number.isSafeInteger(job[key]) ||
      job[key] < (key === "width" || key === "height" ? 1 : 0)
    )
      throw new Error(`Invalid ${key}`);
  }
  if (!Number.isFinite(job.fps) || job.fps <= 0 || job.fps > 240)
    throw new Error("FPS must be between 0 and 240");
  if (job.endFrame < job.startFrame)
    throw new Error("End frame precedes start frame");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(job.id) || !job.contentId.trim())
    throw new Error("Supply a safe job ID and nonempty contentId");
  if (
    job.cameraFit &&
    !["auto", "horizontal", "vertical"].includes(job.cameraFit)
  )
    throw new Error("Invalid camera fit");
}
export class RenderSession {
  private listeners = new Set<(progress: Progress) => void>();
  private frameListeners = new Set<
    (frame: CapturedFrame, index: number) => void
  >();
  private controller?: AbortController;
  private pending?: Promise<void>;
  private pauseRequested = false;
  private wake?: () => void;
  private progress: Progress = {
    state: "idle",
    completed: 0,
    total: 0,
    elapsedMs: 0,
  };
  constructor(private readonly options: SessionOptions) {}
  get status(): Readonly<Progress> {
    return { ...this.progress };
  }
  get busy(): boolean {
    return !!this.pending;
  }
  subscribe(listener: (progress: Progress) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /** Frame storage is borrowed: copy pixels if retaining them beyond this callback. */
  onFrame(listener: (frame: CapturedFrame, index: number) => void): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }
  private publish(update: Partial<Progress>) {
    this.progress = { ...this.progress, ...update };
    for (const listener of this.listeners) {
      try {
        listener(this.status);
      } catch (error) {
        console.error("RenderSession subscriber", error);
      }
    }
  }
  start(job: RenderJob, destination: RenderDestination): Promise<void> {
    if (this.pending || this.progress.state === "disposed")
      return Promise.reject(new Error("Session is busy or disposed"));
    try {
      validateJob(job);
    } catch (error) {
      return Promise.reject(error);
    }
    this.controller = new AbortController();
    this.pauseRequested = false;
    const signal = this.controller.signal;
    // Mark ownership before notifying observers; observers may call back into us.
    this.pending = Promise.resolve()
      .then(() => this.run({ ...job }, destination, signal))
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  /** Capture a still through the same exclusive lifecycle without saving it. */
  async preview(
    job: RenderJob,
    frame = job.startFrame,
  ): Promise<CapturedFrame | undefined> {
    let image: CapturedFrame | undefined;
    await this.start(
      { ...job, startFrame: frame, endFrame: frame },
      {
        async open() {
          return new Set<number>();
        },
        async write(value) {
          image = { ...value, pixels: value.pixels.slice() };
        },
        async close() {},
        async abort() {},
      },
    );
    return this.progress.state === "cancelled" ? undefined : image;
  }
  pause() {
    if (this.busy && !this.controller?.signal.aborted)
      this.pauseRequested = true;
  }
  resume() {
    this.pauseRequested = false;
    this.wake?.();
  }
  cancel() {
    if (this.busy && !this.controller?.signal.aborted) {
      this.controller?.abort(new DOMException("Cancelled", "AbortError"));
      this.publish({ state: "cancelling" });
      this.resume();
    }
  }
  private async run(
    job: RenderJob,
    destination: RenderDestination,
    signal: AbortSignal,
  ) {
    const started = performance.now();
    let snapshot: unknown;
    let acquired = false;
    let failure: unknown;
    let cleanupFailed = false;
    let rendered = 0;
    const total = job.endFrame - job.startFrame + 1;
    this.publish({
      state: "preparing",
      completed: 0,
      total,
      frame: undefined,
      error: undefined,
      elapsedMs: 0,
      etaMs: undefined,
    });
    try {
      signal.throwIfAborted();
      const saved = await destination.open(job, signal);
      signal.throwIfAborted();
      await this.options.capture.prepare(job);
      signal.throwIfAborted();
      snapshot = await this.options.animation.acquire();
      acquired = true;
      signal.throwIfAborted();
      const completed = [...saved].filter(
        (f) => f >= job.startFrame && f <= job.endFrame,
      ).length;
      this.publish({ state: "rendering", completed });
      for (let frame = job.startFrame; frame <= job.endFrame; frame++) {
        signal.throwIfAborted();
        if (saved.has(frame)) continue;
        if (this.pauseRequested) {
          await new Promise<void>((resolve) => {
            this.wake = resolve;
            this.publish({ state: "paused" });
          });
          this.wake = undefined;
          signal.throwIfAborted();
          this.publish({ state: "rendering" });
        }
        const context = {
          frame,
          time: frame / job.fps,
          delta: 1 / job.fps,
          signal,
        };
        await this.options.animation.seek(context);
        await this.options.animation.ready?.(context);
        signal.throwIfAborted();
        const image = await this.options.capture.capture(context);
        signal.throwIfAborted();
        for (const listener of this.frameListeners) {
          try {
            listener(image, frame);
          } catch (error) {
            console.error("RenderSession preview", error);
          }
        }
        await destination.write(image, context);
        signal.throwIfAborted();
        rendered++;
        const elapsedMs = performance.now() - started;
        this.publish({
          completed: completed + rendered,
          frame,
          elapsedMs,
          etaMs: (elapsedMs / rendered) * (total - completed - rendered),
        });
      }
      await destination.close();
      signal.throwIfAborted();
    } catch (error) {
      failure = error;
      try {
        await destination.abort(error);
      } catch (cleanup) {
        failure = new AggregateError(
          [error, cleanup],
          "Export and destination cleanup failed",
        );
      }
    } finally {
      try {
        await this.options.capture.finish();
      } catch (error) {
        failure = error;
        cleanupFailed = true;
      }
      if (acquired) {
        try {
          await this.options.animation.restore(snapshot);
        } catch (error) {
          failure = new Error("Application state restoration failed", {
            cause: error,
          });
          cleanupFailed = true;
        }
      }
    }
    if (failure) {
      const cancelled =
        signal.aborted &&
        !cleanupFailed &&
        !(failure instanceof AggregateError) &&
        !(failure instanceof Error && failure.message.includes("restoration"));
      this.publish({
        state: cancelled ? "cancelled" : "failed",
        error: cancelled ? undefined : String(failure),
        elapsedMs: performance.now() - started,
        etaMs: undefined,
      });
      if (!cancelled) throw failure;
    } else
      this.publish({
        state: "completed",
        elapsedMs: performance.now() - started,
        etaMs: 0,
      });
  }
  async dispose() {
    this.cancel();
    await this.pending?.catch(() => {});
    await this.options.capture.dispose();
    this.publish({ state: "disposed" });
    this.listeners.clear();
    this.frameListeners.clear();
  }
}
