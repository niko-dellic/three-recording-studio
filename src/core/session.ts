import { validateJob } from "./validation.js";
export { validateJob } from "./validation.js";
import { inspectRender, PreflightError } from "./capabilities.js";
import { resolveRenderSettings } from "./resolution.js";
import { frameSceneTime } from "./timeline.js";
import { validateCapturedFrame, InvalidFrameError } from "./frames.js";
import type {
  CapturedFrame,
  Progress,
  PreparationContext,
  RenderDiagnostic,
  RenderPhase,
  RenderDestination,
  RenderJob,
  SessionOptions,
} from "./types.js";
export class RenderSession {
  private listeners = new Set<(progress: Progress) => void>();
  private frameListeners = new Set<
    (frame: CapturedFrame, index: number) => void
  >();
  private controller?: AbortController;
  private pending?: Promise<void>;
  private disposing?: Promise<void>;
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
  /** Read-only checks: never opens a destination or acquires animation state. */
  inspect(
    job: RenderJob,
    destination: RenderDestination,
    signal?: AbortSignal,
  ) {
    return inspectRender(job, this.options.capture, destination, signal);
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
    if (this.pending || this.disposing || this.progress.state === "disposed")
      return Promise.reject(new Error("Session is busy or disposed"));
    try {
      validateJob(job);
      job = resolveRenderSettings(job);
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
    const failures: unknown[] = [];
    const diagnostics: RenderDiagnostic[] = [];
    let phase: RenderPhase = "preflight";
    let currentFrame: number | undefined;
    const diagnose = (
      error: unknown,
      failedPhase: RenderPhase,
      cleanup = false,
    ) => {
      diagnostics.push(
        Object.freeze({
          code: cleanup
            ? "CLEANUP_FAILED"
            : error instanceof InvalidFrameError
              ? "INVALID_FRAME"
              : "RENDER_FAILED",
          phase: failedPhase,
          jobId: job.id,
          frame: currentFrame,
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    };
    let cleanupFailed = false;
    let destinationAttempted = false;
    let captureAttempted = false;
    const deferred: Array<() => void | Promise<void>> = [];
    const preparation: PreparationContext = {
      signal,
      defer(cleanup) {
        deferred.push(cleanup);
      },
    };
    const cleanupFailure = (
      message: string,
      cause: unknown,
      failedPhase: RenderPhase,
    ) => {
      diagnose(cause, failedPhase, true);
      cleanupFailed = true;
      failures.push(new Error(message, { cause }));
    };
    let rendered = 0;
    const total = job.endFrame - job.startFrame + 1;
    this.publish({
      state: "preparing",
      completed: 0,
      total,
      frame: undefined,
      error: undefined,
      diagnostics: undefined,
      elapsedMs: 0,
      etaMs: undefined,
    });
    try {
      signal.throwIfAborted();
      const inspection = await this.inspect(job, destination, signal);
      if (!inspection.valid) throw new PreflightError(inspection);
      signal.throwIfAborted();
      phase = "open";
      destinationAttempted = true;
      const saved = await destination.open(job, signal);
      signal.throwIfAborted();
      phase = "acquire";
      snapshot = await this.options.animation.acquire(preparation);
      acquired = true;
      signal.throwIfAborted();
      phase = "prepare";
      captureAttempted = true;
      await this.options.capture.prepare(job, preparation);
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
          time: frameSceneTime(frame, job.fps, job.sampleIntervalSeconds),
          delta: job.sampleIntervalSeconds ?? 1 / job.fps,
          signal,
        };
        currentFrame = frame;
        phase = "seek";
        await this.options.animation.seek(context);
        phase = "ready";
        await this.options.animation.ready?.(context);
        signal.throwIfAborted();
        phase = "capture";
        const image = await this.options.capture.capture(context);
        validateCapturedFrame(image, job);
        signal.throwIfAborted();
        for (const listener of this.frameListeners) {
          try {
            listener(image, frame);
          } catch (error) {
            console.error("RenderSession preview", error);
          }
        }
        phase = "write";
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
      phase = "finalize";
      await destination.close();
      signal.throwIfAborted();
    } catch (error) {
      failures.push(error);
      diagnose(error, phase);
      if (destinationAttempted) {
        try {
          await destination.abort(error);
        } catch (error) {
          cleanupFailure("Destination cleanup failed", error, "abort");
        }
      }
    } finally {
      if (captureAttempted) {
        try {
          await this.options.capture.finish();
        } catch (error) {
          cleanupFailure("Capture cleanup failed", error, "finish");
        }
      }
      if (acquired) {
        try {
          await this.options.animation.restore(snapshot);
        } catch (error) {
          cleanupFailure(
            "Application state restoration failed",
            error,
            "restore",
          );
        }
      }
      for (const cleanup of deferred.reverse()) {
        try {
          await cleanup();
        } catch (error) {
          cleanupFailure("Deferred resource cleanup failed", error, "cleanup");
        }
      }
    }
    if (failures.length) {
      const failure =
        failures.length === 1
          ? failures[0]
          : new AggregateError(
              failures,
              failures.map((error) => String(error)).join("; "),
            );
      const cancelled = signal.aborted && !cleanupFailed;
      this.publish({
        state: cancelled ? "cancelled" : "failed",
        error: cancelled ? undefined : String(failure),
        diagnostics: cancelled ? undefined : Object.freeze(diagnostics),
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
  dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    // Close admission synchronously, before cancellation notifies subscribers.
    this.disposing = Promise.resolve().then(async () => {
      await this.pending?.catch(() => {});
      try {
        await this.options.capture.dispose();
      } finally {
        this.publish({ state: "disposed" });
        this.listeners.clear();
        this.frameListeners.clear();
      }
    });
    this.cancel();
    return this.disposing;
  }
}
