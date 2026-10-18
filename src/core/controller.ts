import {
  createRecordingSettings,
  type RecordingSettingsStore,
} from "./settings.js";
import type { RenderSession } from "./session.js";
import type { CapturedFrame, RenderDestination, RenderJob } from "./types.js";
import { pngBlob } from "../destinations/pixels.js";
export interface RenderControllerOptions {
  session: RenderSession;
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
    this.jobId = crypto.randomUUID();
    this.publish();
    try {
      return await action();
    } catch (error) {
      this.error = String(error);
      throw error;
    } finally {
      this.operation = false;
      this.publish();
    }
  }
  start() {
    return this.run(async () => {
      const job = this.getJob();
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
      const result = {
        blob: await pngBlob(image),
        filename: `${job.fileName ?? job.id}-frame-${frame}.png`,
        channel,
      };
      for (const listener of this.imageListeners) listener(result);
      return result;
    });
  }
  /** Disconnect UI subscriptions without cancelling an application-owned session. */
  dispose() {
    this.disposed = true;
    this.unsubscribe();
    this.listeners.clear();
    this.imageListeners.clear();
  }
}
