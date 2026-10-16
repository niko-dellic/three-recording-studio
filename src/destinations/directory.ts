import type {
  CapturedFrame,
  FrameContext,
  RenderDestination,
  RenderJob,
} from "../core/types.js";
import { pngBlob } from "./pixels.js";

/** Write PNGs into a fresh subfolder of a user-selected directory. */
export class DirectoryDestination implements RenderDestination {
  private output?: FileSystemDirectoryHandle;
  private signal?: AbortSignal;
  private job?: RenderJob;
  private completed: number[] = [];
  constructor(private readonly directory: FileSystemDirectoryHandle) {}
  async open(job: RenderJob, signal: AbortSignal) {
    signal.throwIfAborted();
    this.signal = signal;
    this.job = { ...job };
    this.completed = [];
    this.output = await this.directory.getDirectoryHandle(
      `${job.fileName ?? job.id}-${crypto.randomUUID()}`,
      { create: true },
    );
    await this.manifest("rendering");
    return new Set<number>();
  }
  private async save(name: string, data: Blob | string) {
    const handle = await this.output!.getFileHandle(name, { create: true });
    const writer = await handle.createWritable();
    try {
      await writer.write(data);
      await writer.close();
    } catch (error) {
      await writer.abort().catch(() => {});
      throw error;
    }
  }
  private manifest(state: string) {
    return this.save(
      "render.json",
      JSON.stringify(
        { job: this.job, state, completed: this.completed },
        null,
        2,
      ),
    );
  }
  async write(frame: CapturedFrame, context: FrameContext) {
    this.signal!.throwIfAborted();
    const blob = await pngBlob(frame);
    this.signal!.throwIfAborted();
    await this.save(
      `${this.job!.fileName ? this.job!.fileName + "-" : ""}${String(context.frame).padStart(6, "0")}.png`,
      blob,
    );
    this.completed.push(context.frame);
    await this.manifest("rendering");
  }
  async close() {
    this.signal!.throwIfAborted();
    await this.manifest("completed");
  }
  async abort() {
    if (this.output) await this.manifest("interrupted");
  }
}
