import type {
  CapturedFrame,
  FrameContext,
  RenderDestination,
  RenderJob,
} from "../core/types.js";
import { pngBlob } from "./pixels.js";

export interface SequenceFrame {
  blob: Blob;
  filename: string;
  frame: number;
}
export interface PngSequence {
  frames: SequenceFrame[];
  archive: Blob;
  job: RenderJob;
}
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
/** ZIP STORE keeps already-compressed PNGs intact. ZIP64 is deliberately excluded. */
export async function zipFrames(
  frames: SequenceFrame[],
  signal: AbortSignal,
): Promise<Blob> {
  if (frames.length > 65535) throw Error("ZIP frame limit exceeded");
  const parts: BlobPart[] = [],
    central: BlobPart[] = [];
  let offset = 0,
    directorySize = 0;
  for (const frame of frames) {
    signal.throwIfAborted();
    const bytes = new Uint8Array(await frame.blob.arrayBuffer());
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const name = new TextEncoder().encode(frame.filename);
    const header = new Uint8Array(30 + name.length),
      h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x800, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, bytes.length, true);
    h.setUint32(22, bytes.length, true);
    h.setUint16(26, name.length, true);
    header.set(name, 30);
    const entry = new Uint8Array(46 + name.length),
      e = new DataView(entry.buffer);
    e.setUint32(0, 0x02014b50, true);
    e.setUint16(4, 20, true);
    e.setUint16(6, 20, true);
    e.setUint16(8, 0x800, true);
    e.setUint32(16, crc, true);
    e.setUint32(20, bytes.length, true);
    e.setUint32(24, bytes.length, true);
    e.setUint16(28, name.length, true);
    e.setUint32(42, offset, true);
    entry.set(name, 46);
    parts.push(header, frame.blob);
    central.push(entry);
    offset += header.length + bytes.length;
    directorySize += entry.length;
  }
  const end = new Uint8Array(22),
    view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, frames.length, true);
  view.setUint16(10, frames.length, true);
  view.setUint32(12, directorySize, true);
  view.setUint32(16, offset, true);
  signal.throwIfAborted();
  return new Blob([...parts, ...central, end], { type: "application/zip" });
}
export class MemorySequenceDestination implements RenderDestination {
  capabilities() {
    return {
      transparent: true,
      resumable: false,
      maxFrames: 65535,
      memoryLimitBytes: this.options.maxBytes ?? 128 * 1024 * 1024,
    };
  }
  private frames: SequenceFrame[] = [];
  private bytes = 22;
  private job!: RenderJob;
  private signal!: AbortSignal;
  constructor(
    private readonly options: {
      onComplete: (sequence: PngSequence) => void | Promise<void>;
      /** Includes PNGs and ZIP headers; the archive can require a second copy. */
      maxBytes?: number;
    },
  ) {}
  check(job: RenderJob) {
    const limit = this.options.maxBytes ?? 128 * 1024 * 1024;
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw Error("Invalid PNG memory limit");
    if (job.endFrame - job.startFrame + 1 > 65535)
      throw Error("PNG memory export supports at most 65535 frames");
  }
  async open(job: RenderJob, signal: AbortSignal) {
    this.check(job);
    this.job = { ...job };
    this.signal = signal;
    this.frames = [];
    this.bytes = 22;
    signal.throwIfAborted();
    return new Set<number>();
  }
  async write(frame: CapturedFrame, context: FrameContext) {
    this.signal.throwIfAborted();
    const blob = await pngBlob(frame);
    this.signal.throwIfAborted();
    const filename = `${this.job.fileName ?? this.job.id}-${String(context.frame).padStart(8, "0")}.png`;
    this.bytes +=
      blob.size + 76 + new TextEncoder().encode(filename).length * 2;
    if (this.bytes > (this.options.maxBytes ?? 128 * 1024 * 1024))
      throw Error(
        "PNG memory limit reached. Use Folder or Receiver for longer sequences.",
      );
    this.frames.push({ blob, filename, frame: context.frame });
  }
  async close() {
    const archive = await zipFrames(this.frames, this.signal);
    await this.options.onComplete({
      frames: this.frames,
      archive,
      job: this.job,
    });
    this.frames = [];
  }
  async abort() {
    this.frames = [];
  }
}
