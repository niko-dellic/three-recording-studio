import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
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
  onComplete: (blob: Blob) => void | Promise<void>;
  /** Explicit memory ceiling for the buffered output file. Default 256 MiB. */
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
  constructor(private readonly options: Mp4DestinationOptions) {}
  capabilities() {
    return {
      transparent: false,
      widthMultiple: 2,
      heightMultiple: 2,
      resumable: false,
      memoryLimitBytes: this.options.maxBytes ?? 256 * 1024 * 1024,
    };
  }
  async check(job: RenderJob, context: { signal: AbortSignal }) {
    context.signal.throwIfAborted();
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
    this.job = job;
    this.signal = signal;
    this.bytes = 0;
    this.canvas = new OffscreenCanvas(job.width, job.height);
    this.context = this.canvas.getContext("2d")!;
    this.target = new BufferTarget();
    this.output = new Output({
      format: new Mp4OutputFormat(),
      target: this.target,
    });
    this.source = new CanvasSource(this.canvas, {
      codec: "avc",
      bitrate: QUALITY_HIGH,
      onEncodedPacket: (packet) => {
        this.bytes += packet.data.byteLength;
        if (this.bytes > (this.options.maxBytes ?? 256 * 1024 * 1024))
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
    await this.output!.finalize();
    this.signal!.throwIfAborted();
    if (this.limitError) throw this.limitError;
    if (
      this.target!.buffer!.byteLength >
      (this.options.maxBytes ?? 256 * 1024 * 1024)
    )
      throw new Error("MP4 memory limit reached");
    await this.options.onComplete(
      new Blob([this.target!.buffer!], { type: "video/mp4" }),
    );
    this.release();
  }
  async abort() {
    try {
      if (
        this.output &&
        this.output.state !== "finalized" &&
        this.output.state !== "canceled"
      )
        await this.output.cancel();
    } finally {
      this.release();
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
