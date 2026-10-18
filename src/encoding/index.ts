import type { RenderCapabilities } from "../core/capabilities.js";
import type { FileStorage, FileChunk } from "../destinations/storage.js";
import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
  StreamTarget,
  CanvasSource,
  QUALITY_HIGH,
  canEncodeVideo,
} from "mediabunny";
import type {
  CapturedFrame,
  FrameContext,
  RenderDestination,
  RenderJob,
} from "../core/types.js";
import { putPixels } from "../destinations/pixels.js";
export interface Mp4DestinationOptions {
  /** Called with the finished MP4; must persist or download it. */
  onComplete?: (blob: Blob) => void | Promise<void>;
  storage?: FileStorage;
  /** Explicit opt-in; requires storage.openStream and does not retain a full output blob. */
  streaming?: boolean;
  /** Output ceiling: defaults to 256 MiB buffered; streaming is unlimited unless specified. */
  maxBytes?: number;
}
export class Mp4Destination implements RenderDestination {
  private output?: Output;
  private target?: BufferTarget;
  private source?: CanvasSource;
  private canvas?: OffscreenCanvas;
  private context?: OffscreenCanvasRenderingContext2D;
  private job?: RenderJob;
  private signal?: AbortSignal;
  private bytes = 0;
  private limitError?: Error;
  private streamWriter?: WritableStreamDefaultWriter<FileChunk>;
  private finalizing = false;
  constructor(private readonly options: Mp4DestinationOptions) {}
  capabilities(): RenderCapabilities {
    return {
      transparent: false,
      widthMultiple: 2,
      heightMultiple: 2,
      resumable: false,
      ...(this.options.streaming
        ? {}
        : {
            memoryLimitBytes: this.options.maxBytes ?? 256 * 1024 * 1024,
          }),
    };
  }
  async check(job: RenderJob, context: { signal: AbortSignal }) {
    context.signal.throwIfAborted();
    if (!this.options.storage && !this.options.onComplete)
      throw new Error("Supply storage or an onComplete callback");
    if (
      this.options.streaming &&
      (!this.options.storage?.openStream || this.options.onComplete)
    )
      throw new Error(
        "Streaming requires stream-capable storage and cannot provide a completed blob callback",
      );
    await this.options.storage?.check?.(job, "mp4", context.signal);
    if (
      !Number.isSafeInteger(this.options.maxBytes ?? 256 * 1024 * 1024) ||
      (this.options.maxBytes ?? 1) <= 0
    )
      throw new Error("maxBytes must be a positive integer");
    if (job.transparent)
      throw new Error("MP4 export is opaque; disable transparency or use PNG");
    if (job.width % 2 || job.height % 2)
      throw new Error("H.264 MP4 requires even output dimensions");
    if (
      !(await canEncodeVideo("avc", {
        width: job.width,
        height: job.height,
        bitrate: QUALITY_HIGH,
      }))
    )
      throw new Error(
        "H.264 encoding is unavailable for these dimensions on this browser",
      );
    context.signal.throwIfAborted();
  }
  async open(job: RenderJob, signal: AbortSignal) {
    await this.check(job, { signal });
    this.limitError = undefined;
    this.finalizing = false;
    this.job = job;
    this.signal = signal;
    this.bytes = 0;
    await this.options.storage?.open(job, "mp4", signal);
    signal.throwIfAborted();
    this.canvas = new OffscreenCanvas(job.width, job.height);
    this.context = this.canvas.getContext("2d")!;
    let target: BufferTarget | StreamTarget;
    if (this.options.streaming) {
      const stream = await this.options.storage!.openStream!(
        `${job.fileName ?? job.id}.mp4`,
        signal,
      );
      this.streamWriter = stream.getWriter();
      target = new StreamTarget(
        new WritableStream<FileChunk>({
          write: async (chunk) => {
            if (signal.aborted) {
              await this.finishStream(false, signal.reason);
              return;
            }
            if (
              this.options.maxBytes !== undefined &&
              chunk.position + chunk.data.byteLength > this.options.maxBytes
            )
              throw new Error("MP4 output limit reached");
            try {
              await this.streamWriter!.write(chunk);
            } catch (error) {
              if (!signal.aborted) throw error;
              await this.finishStream(false, signal.reason);
            }
          },
          // The muxer also closes its target during cancellation. Only a successful
          // finalization may commit the underlying file; cancellation must abort it.
          close: () =>
            this.finishStream(
              this.finalizing && !signal.aborted,
              signal.reason,
            ),
          abort: (reason) => this.finishStream(false, reason),
        }),
      );
    } else target = this.target = new BufferTarget();
    this.output = new Output({
      format: new Mp4OutputFormat(
        this.options.streaming ? { fastStart: "fragmented" } : {},
      ),
      target,
    });
    this.source = new CanvasSource(this.canvas, {
      codec: "avc",
      bitrate: QUALITY_HIGH,
      onEncodedPacket: (packet) => {
        this.bytes += packet.data.byteLength;
        if (
          !this.options.streaming &&
          this.bytes > (this.options.maxBytes ?? 256 * 1024 * 1024)
        )
          this.limitError = new Error(
            "MP4 memory limit reached; use image-sequence export for long jobs",
          );
      },
    });
    this.output.addVideoTrack(this.source, { frameRate: job.fps });
    await this.output.start();
    return new Set<number>();
  }
  async write(frame: CapturedFrame, context: FrameContext) {
    this.signal!.throwIfAborted();
    if (this.limitError) throw this.limitError;
    putPixels(this.context!, frame);
    await this.source!.add(
      (context.frame - this.job!.startFrame) / this.job!.fps,
      1 / this.job!.fps,
    );
    if (this.limitError) throw this.limitError;
  }
  async close() {
    this.source!.close();
    this.finalizing = true;
    await this.output!.finalize();
    this.signal!.throwIfAborted();
    if (this.limitError) throw this.limitError;
    if (!this.options.streaming) {
      if (
        this.target!.buffer!.byteLength >
        (this.options.maxBytes ?? 256 * 1024 * 1024)
      )
        throw new Error("MP4 memory limit reached");
      const blob = new Blob([this.target!.buffer!], { type: "video/mp4" });
      await this.options.storage?.write(
        { blob, filename: `${this.job!.fileName ?? this.job!.id}.mp4` },
        this.signal!,
      );
      await this.options.onComplete?.(blob);
    }
    await this.options.storage?.close();
    this.release();
  }
  async abort(reason?: unknown) {
    const failures: unknown[] = [];
    for (const cleanup of [
      async () => {
        if (
          this.output &&
          this.output.state !== "finalized" &&
          this.output.state !== "canceled"
        )
          await this.output.cancel();
      },
      () => this.finishStream(false, reason),
      () => this.options.storage?.abort(reason),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    this.release();
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, "MP4 cleanup failed");
  }
  private async finishStream(commit: boolean, reason?: unknown) {
    const writer = this.streamWriter;
    if (!writer) return;
    this.streamWriter = undefined;
    try {
      if (commit) await writer.close();
      else await writer.abort(reason);
    } finally {
      writer.releaseLock();
    }
  }
  private release() {
    this.output = undefined;
    this.source = undefined;
    this.target = undefined;
    this.context = undefined;
    this.canvas = undefined;
  }
}
