import type {
  CapturedFrame,
  FrameContext,
  RenderDestination,
  RenderJob,
} from "../core/types.js";
import type { FileStorage, OutputFormat } from "./storage.js";
import { pngBlob } from "./pixels.js";

export class PngDestination implements RenderDestination {
  private job?: RenderJob;
  private signal?: AbortSignal;
  constructor(private readonly storage: FileStorage) {}
  capabilities() {
    return {
      transparent: true,
      resumable: this.storage.resumable ?? false,
      memoryLimitBytes: this.storage.maxBytes,
    };
  }
  check(job: RenderJob, context: { signal: AbortSignal }) {
    return this.storage.check?.(job, "png", context.signal);
  }
  async open(job: RenderJob, signal: AbortSignal) {
    this.job = { ...job };
    this.signal = signal;
    return this.storage.open(job, "png", signal);
  }
  async write(frame: CapturedFrame, context: FrameContext) {
    const blob = await pngBlob(frame);
    context.signal.throwIfAborted();
    await this.storage.write(
      {
        blob,
        frame: context.frame,
        filename: `${this.job!.fileName ?? this.job!.id}-${String(context.frame).padStart(8, "0")}.png`,
      },
      context.signal,
    );
  }
  async close() {
    this.signal!.throwIfAborted();
    await this.storage.close();
  }
  async abort(reason: unknown) {
    await this.storage.abort(reason);
  }
}
/** Choose encoding and storage independently. MP4 loads the optional encoder lazily. */
export async function createRecordingDestination(options: {
  format: OutputFormat;
  storage: FileStorage;
  /** MP4 only; requires storage.openStream. Buffered output remains the default. */
  streaming?: boolean;
  maxBytes?: number;
}): Promise<RenderDestination> {
  if (options.format === "png") {
    if (options.streaming)
      throw new Error(
        "PNG writes individual files; MP4 streaming is not applicable",
      );
    return new PngDestination(options.storage);
  }
  const { Mp4Destination } = await import("../encoding/index.js");
  return new Mp4Destination({
    storage: options.storage,
    streaming: options.streaming,
    maxBytes: options.maxBytes,
  });
}
