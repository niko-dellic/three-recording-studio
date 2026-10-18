import type { RenderJob } from "./types.js";
import type { PngSequence } from "../destinations/memory.js";

export interface RenderResultInput {
  blob: Blob;
  filename: string;
  channel?: string;
  job?: RenderJob;
  sequence?: PngSequence;
  /** Small preview image, independent of the full recording payload. */
  thumbnail?: Blob;
}
export interface RenderResult extends Readonly<
  Omit<RenderResultInput, "sequence">
> {
  readonly sequence?: Readonly<Omit<PngSequence, "frames">> & {
    readonly frames: readonly Readonly<PngSequence["frames"][number]>[];
  };
  readonly id: string;
  readonly channel: string;
  readonly createdAt: number;
  readonly bytes: number;
}
export interface ResultSaveState {
  readonly state: "unsaved" | "saving" | "saved" | "failed";
  readonly error?: string;
}
export type ResultWriter = (
  result: RenderResult,
  signal: AbortSignal,
) => Promise<void>;
const UNSAVED: ResultSaveState = Object.freeze({ state: "unsaved" });

/** Owns retained blobs, never DOM or object URLs. Share across mounted previews. */
export class RenderResults {
  private snapshot: readonly RenderResult[] = Object.freeze([]);
  private listeners = new Set<() => void>();
  private saves = new Map<
    string,
    {
      state: ResultSaveState;
      writer: ResultWriter;
      abort?: AbortController;
      pending?: Promise<void>;
    }
  >();
  private disposed = false;
  readonly maxBytes: number;
  constructor(options: { maxBytes?: number } = {}) {
    this.maxBytes = options.maxBytes ?? 256 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1)
      throw new Error("Invalid result memory limit");
  }
  getSnapshot = (): readonly RenderResult[] => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish() {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.error("RenderResults subscriber", error);
      }
    }
  }
  get retainedBytes() {
    return this.snapshot.reduce((sum, result) => sum + result.bytes, 0);
  }
  add(input: RenderResultInput): RenderResult {
    if (this.disposed) throw new Error("Render results are disposed");
    const channel = input.channel ?? "1";
    const bytes =
      input.blob.size +
      (input.thumbnail?.size ?? 0) +
      (input.sequence?.frames.reduce(
        (sum, frame) => sum + frame.blob.size,
        0,
      ) ?? 0);
    const previous = this.snapshot.find((result) => result.channel === channel);
    if (this.retainedBytes - (previous?.bytes ?? 0) + bytes > this.maxBytes)
      throw new Error(
        "Channel memory limit reached. Delete a render or save to Folder or Receiver.",
      );
    const sequence = input.sequence
      ? Object.freeze({
          ...input.sequence,
          job: Object.freeze({ ...input.sequence.job }),
          frames: Object.freeze(
            input.sequence.frames.map((frame) => Object.freeze({ ...frame })),
          ),
        })
      : undefined;
    const result: RenderResult = Object.freeze({
      ...input,
      channel,
      bytes,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      job: input.job ? Object.freeze({ ...input.job }) : undefined,
      sequence,
    });
    if (previous) this.cancelSave(previous.id);
    if (previous) this.saves.delete(previous.id);
    this.snapshot = Object.freeze([
      ...this.snapshot.filter((item) => item.channel !== channel),
      result,
    ]);
    this.publish();
    return result;
  }
  remove(id: string) {
    if (!this.snapshot.some((result) => result.id === id)) return;
    this.cancelSave(id);
    this.saves.delete(id);
    this.snapshot = Object.freeze(
      this.snapshot.filter((result) => result.id !== id),
    );
    this.publish();
  }
  setThumbnail(id: string, thumbnail: Blob) {
    const result = this.snapshot.find((item) => item.id === id);
    if (!result || this.disposed) return;
    const bytes = result.bytes - (result.thumbnail?.size ?? 0) + thumbnail.size;
    if (this.retainedBytes - result.bytes + bytes > this.maxBytes)
      throw new Error("Result thumbnail exceeds memory limit");
    this.snapshot = Object.freeze(
      this.snapshot.map((item) =>
        item.id === id ? Object.freeze({ ...item, thumbnail, bytes }) : item,
      ),
    );
    this.publish();
  }
  getSaveState(id: string): ResultSaveState {
    return this.saves.get(id)?.state ?? UNSAVED;
  }
  save(id: string, writer: ResultWriter): Promise<void> {
    const result = this.snapshot.find((item) => item.id === id);
    if (!result || this.disposed)
      return Promise.reject(new Error("Recording is no longer retained"));
    const existing = this.saves.get(id);
    if (existing?.pending) return existing.pending;
    const abort = new AbortController();
    const entry: {
      writer: ResultWriter;
      abort?: AbortController;
      state: ResultSaveState;
      pending?: Promise<void>;
    } = {
      writer,
      abort,
      state: Object.freeze({ state: "saving" }) as ResultSaveState,
      pending: undefined as Promise<void> | undefined,
    };
    this.saves.set(id, entry);
    entry.pending = Promise.resolve()
      .then(() => {
        abort.signal.throwIfAborted();
        return writer(result, abort.signal);
      })
      .then(() => {
        abort.signal.throwIfAborted();
        entry.state = Object.freeze({ state: "saved" });
      })
      .catch((error) => {
        entry.state = Object.freeze({ state: "failed", error: String(error) });
        throw error;
      })
      .finally(() => {
        entry.pending = undefined;
        entry.abort = undefined;
        if (this.saves.get(id) === entry) this.publish();
      });
    this.publish();
    return entry.pending;
  }
  retry(id: string): Promise<void> {
    const entry = this.saves.get(id);
    return entry
      ? this.save(id, entry.writer)
      : Promise.reject(new Error("No previous save to retry"));
  }
  cancelSave(id: string) {
    this.saves
      .get(id)
      ?.abort?.abort(new DOMException("Save cancelled", "AbortError"));
  }
  dispose() {
    this.disposed = true;
    for (const id of this.saves.keys()) this.cancelSave(id);
    this.saves.clear();
    this.snapshot = Object.freeze([]);
    this.publish();
    this.listeners.clear();
  }
}
