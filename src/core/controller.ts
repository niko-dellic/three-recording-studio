import { resolveRenderSettings } from "./resolution.js";
import { RenderResults, type RenderResultInput } from "./results.js";
import { createFrameThumbnail } from "./thumbnail.js";
import {
  createRecordingSettings,
  type RecordingSettingsStore,
} from "./settings.js";
import type { RenderSession } from "./session.js";
import type { CapturedFrame, RenderDestination, RenderJob } from "./types.js";
import { pngBlob } from "../destinations/pixels.js";
export interface RenderControllerOptions {
  session: RenderSession;
  /** Externally owned results survive controller disposal. */
  results?: RenderResults;
  maxRetainedBytes?: number;
  job: RenderJob;
  settings?: RecordingSettingsStore;
  destination(job: RenderJob): RenderDestination | Promise<RenderDestination>;
  imageDestination?(
    job: RenderJob,
  ): RenderDestination | undefined | Promise<RenderDestination | undefined>;
  currentFrame?(): number;
}
export interface StillResult {
  blob: Blob;
  filename: string;
  channel: string;
}
/** Shared commands and state; independently mounted views have no job ownership. */
export class RenderController {
  readonly settings: RecordingSettingsStore;
  readonly session: RenderSession;
  readonly results: RenderResults;
  private unsubscribeFrame: () => void;
  private thumbnail?: Promise<Blob | undefined>;
  private activeJob?: RenderJob;
  channel = "1";
  error?: string;
  private operation = false;
  private disposed = false;
  private listeners = new Set<() => void>();
  private imageListeners = new Set<(result: StillResult) => void>();
  private unsubscribe: () => void;
  private jobId = crypto.randomUUID();
  constructor(private readonly options: RenderControllerOptions) {
    this.session = options.session;
    this.results =
      options.results ??
      new RenderResults({ maxBytes: options.maxRetainedBytes });
    this.unsubscribeFrame = this.session.onFrame((frame) => {
      if (
        this.operation &&
        !this.thumbnail &&
        typeof OffscreenCanvas !== "undefined"
      )
        this.thumbnail = createFrameThumbnail(frame).catch((error) => {
          console.warn("Recording thumbnail", error);
          return undefined;
        });
    });
    this.settings =
      options.settings ??
      createRecordingSettings({
        cameraFit: "auto",
        transparent: true,
        ...options.job,
        fileName: options.job.fileName ?? options.job.id,
      });
    this.unsubscribe = this.session.subscribe(() => this.publish());
  }
  get busy() {
    return (
      this.operation ||
      ["preparing", "rendering", "paused", "cancelling"].includes(
        this.session.status.state,
      )
    );
  }
  get status() {
    return this.session.status;
  }
  getJob(): RenderJob {
    return {
      ...this.settings.getSnapshot(),
      id: this.jobId,
      contentId: this.options.job.contentId,
    };
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    listener();
    return () => {
      this.listeners.delete(listener);
    };
  }
  onImage(listener: (result: StillResult) => void) {
    this.imageListeners.add(listener);
    return () => {
      this.imageListeners.delete(listener);
    };
  }
  addResult(input: RenderResultInput) {
    if (this.disposed) return;
    const result = this.results.add({
      ...input,
      job: input.job ?? this.activeJob,
      channel: input.channel ?? this.channel,
    });
    if (!result.thumbnail && this.operation && this.thumbnail)
      void this.thumbnail
        .then((thumbnail) => {
          if (thumbnail) this.results.setThumbnail(result.id, thumbnail);
        })
        .catch((error) => console.warn("Recording thumbnail", error));
    return result;
  }
  reportError(error: unknown) {
    this.error = String(error);
    this.publish();
  }
  private publish() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error("RenderController subscriber", error);
      }
    }
  }
  private async run<T>(action: () => Promise<T>): Promise<T | undefined> {
    if (this.disposed) throw new Error("Render controller is disposed");
    if (this.busy || this.session.busy) return;
    this.operation = true;
    this.error = undefined;
    this.thumbnail = undefined;
    this.jobId = crypto.randomUUID();
    this.publish();
    try {
      return await action();
    } catch (error) {
      this.error = String(error);
      throw error;
    } finally {
      this.operation = false;
      this.activeJob = undefined;
      this.publish();
    }
  }
  start() {
    return this.run(async () => {
      const job = this.getJob();
      this.activeJob = resolveRenderSettings(job);
      await this.session.start(job, await this.options.destination(job));
    });
  }
  preview() {
    return this.run(() =>
      this.session.preview(this.getJob(), this.options.currentFrame?.()),
    );
  }
  renderImage() {
    return this.run(async () => {
      const job = this.getJob(),
        channel = this.channel;
      const frame = this.options.currentFrame?.() ?? job.startFrame;
      const stillJob = { ...job, startFrame: frame, endFrame: frame };
      this.activeJob = resolveRenderSettings(stillJob);
      const previousId = this.results
        .getSnapshot()
        .find((result) => result.channel === channel)?.id;
      const destination = await this.options.imageDestination?.(stillJob);
      let image: CapturedFrame | undefined;
      if (destination) {
        await this.session.start(stillJob, {
          open: (job, signal) => destination.open(job, signal),
          async write(value, context) {
            await destination.write(value, context);
            image = { ...value, pixels: value.pixels.slice() };
          },
          close: () => destination.close(),
          abort: (reason) => destination.abort(reason),
        });
        if (this.status.state !== "completed") return;
      } else image = await this.session.preview(stillJob, frame);
      if (!image) return;
      // A destination may already have retained its output in onComplete.
      const retained = this.results
        .getSnapshot()
        .find((result) => result.channel === channel);
      const existing = retained?.id !== previousId ? retained : undefined;
      const result = existing
        ? { blob: existing.blob, filename: existing.filename, channel }
        : {
            blob: await pngBlob(image),
            filename: `${job.fileName ?? job.id}-frame-${frame}.png`,
            channel,
          };
      if (!existing) this.addResult(result);
      for (const listener of this.imageListeners) {
        try {
          listener(result);
        } catch (error) {
          console.error("RenderController image subscriber", error);
        }
      }
      return result;
    });
  }
  /** Disconnect UI subscriptions without cancelling an application-owned session. */
  dispose() {
    this.disposed = true;
    this.unsubscribe();
    this.unsubscribeFrame();
    this.thumbnail = undefined;
    if (!this.options.results) this.results.dispose();
    this.listeners.clear();
    this.imageListeners.clear();
  }
}
