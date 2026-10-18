import type { RenderJob } from "../core/types.js";
import {
  WebSocketDestination,
  type WebSocketDestinationOptions,
} from "./websocket.js";

export type OutputFormat = "png" | "mp4";
export interface EncodedFile {
  readonly filename: string;
  readonly blob: Blob;
  readonly frame?: number;
}
/** Seek-aware writes; compatible with browser file streams and muxer targets. */
export interface FileChunk {
  type: "write";
  data: Uint8Array<ArrayBuffer>;
  position: number;
}
/** Storage owns persistence; it never receives raw pixels or performs encoding. */
export interface FileStorage {
  readonly maxBytes?: number;
  readonly resumable?: boolean;
  check?(
    job: RenderJob,
    format: OutputFormat,
    signal: AbortSignal,
  ): void | Promise<void>;
  open(
    job: RenderJob,
    format: OutputFormat,
    signal: AbortSignal,
  ): Promise<ReadonlySet<number>>;
  write(file: EncodedFile, signal: AbortSignal): Promise<void>;
  /** Optional streaming support, explicitly chosen by the encoder caller. */
  openStream?(
    filename: string,
    signal: AbortSignal,
  ): Promise<WritableStream<FileChunk>>;
  close(): Promise<void>;
  abort(reason: unknown): Promise<void>;
}

/** Bounded retained files for either format; no automatic download. */
export class MemoryFileStorage implements FileStorage {
  readonly maxBytes: number;
  private files: readonly EncodedFile[] = Object.freeze([]);
  private bytes = 0;
  constructor(
    private readonly options: {
      maxBytes?: number;
      onComplete?(files: readonly EncodedFile[]): void | Promise<void>;
    } = {},
  ) {
    this.maxBytes = options.maxBytes ?? 128 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1)
      throw new Error("Invalid storage memory limit");
  }
  getFiles() {
    return this.files;
  }
  async open(_job: RenderJob, _format: OutputFormat, signal: AbortSignal) {
    signal.throwIfAborted();
    this.files = Object.freeze([]);
    this.bytes = 0;
    return new Set<number>();
  }
  async write(file: EncodedFile, signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.bytes + file.blob.size > this.maxBytes)
      throw new Error("Storage memory limit reached");
    this.files = Object.freeze([...this.files, Object.freeze({ ...file })]);
    this.bytes += file.blob.size;
  }
  async close() {
    await this.options.onComplete?.(this.files);
  }
  async abort() {
    this.files = Object.freeze([]);
    this.bytes = 0;
  }
}

function safeFilename(filename: string) {
  if (
    !/^[a-zA-Z0-9_.-]+$/.test(filename) ||
    filename === "." ||
    filename === ".."
  )
    throw new Error("Invalid output filename");
}
/** Each run receives its own folder; streams remain owned until close or abort. */
export class DirectoryFileStorage implements FileStorage {
  private folder?: FileSystemDirectoryHandle;
  private streams = new Set<FileSystemWritableFileStream>();
  constructor(private readonly directory: FileSystemDirectoryHandle) {}
  async open(job: RenderJob, _format: OutputFormat, signal: AbortSignal) {
    signal.throwIfAborted();
    const name = job.fileName ?? job.id;
    safeFilename(name);
    this.folder = await this.directory.getDirectoryHandle(
      `${name}-${crypto.randomUUID()}`,
      { create: true },
    );
    signal.throwIfAborted();
    return new Set<number>();
  }
  async write(file: EncodedFile, signal: AbortSignal) {
    safeFilename(file.filename);
    signal.throwIfAborted();
    if (!this.folder) throw new Error("Storage is not open");
    const handle = await this.folder.getFileHandle(file.filename, {
      create: true,
    });
    const writer = await handle.createWritable();
    this.streams.add(writer);
    try {
      await writer.write(file.blob);
      signal.throwIfAborted();
      await writer.close();
    } catch (error) {
      await writer.abort().catch(() => {});
      throw error;
    } finally {
      this.streams.delete(writer);
    }
  }
  async openStream(
    filename: string,
    signal: AbortSignal,
  ): Promise<WritableStream<FileChunk>> {
    safeFilename(filename);
    signal.throwIfAborted();
    if (!this.folder) throw new Error("Storage is not open");
    const handle = await this.folder.getFileHandle(filename, { create: true });
    const writer = await handle.createWritable();
    this.streams.add(writer);
    return new WritableStream<FileChunk>({
      write: async (chunk) => {
        signal.throwIfAborted();
        await writer.write(chunk);
        signal.throwIfAborted();
      },
      close: async () => {
        signal.throwIfAborted();
        await writer.close();
        this.streams.delete(writer);
      },
      abort: async (reason) => {
        try {
          await writer.abort(reason);
        } finally {
          this.streams.delete(writer);
        }
      },
    });
  }
  async close() {
    this.folder = undefined;
  }
  async abort(reason: unknown) {
    const pending = [...this.streams];
    this.streams.clear();
    this.folder = undefined;
    const results = await Promise.allSettled(
      pending.map((writer) => writer.abort(reason)),
    );
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failures.length)
      throw new AggregateError(
        failures.map((result) => result.reason),
        "Output stream cleanup failed",
      );
  }
}

/** Adapter for the bundled receiver protocol, with acknowledged PNG resume. */
export class ReceiverFileStorage implements FileStorage {
  readonly resumable = true;
  private receiver: WebSocketDestination;
  private job?: RenderJob;
  private format?: OutputFormat;
  constructor(options: WebSocketDestinationOptions) {
    this.receiver = new WebSocketDestination(options);
  }
  async open(job: RenderJob, format: OutputFormat, signal: AbortSignal) {
    signal.throwIfAborted();
    this.job = { ...job };
    this.format = format;
    return format === "png"
      ? this.receiver.open(job, signal)
      : new Set<number>();
  }
  async write(file: EncodedFile, signal: AbortSignal) {
    if (!this.job) throw new Error("Storage is not open");
    signal.throwIfAborted();
    if (this.format === "mp4")
      await this.receiver.saveMp4(this.job, file.blob, signal);
    else {
      if (file.frame === undefined)
        throw new Error("PNG receiver requires a frame index");
      await this.receiver.writePng(file.blob, file.frame, signal);
    }
  }
  async close() {
    if (this.format === "png") await this.receiver.close();
    this.job = undefined;
  }
  async abort() {
    await this.receiver.abort();
    this.job = undefined;
  }
}
