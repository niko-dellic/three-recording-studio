export type CameraFit = "auto" | "horizontal" | "vertical";
export interface RenderSettings {
  width: number;
  height: number;
  /** Output playback frame rate. */
  fps: number;
  /** Scene seconds between output frames. Defaults to 1 / fps. */
  sampleIntervalSeconds?: number;
  startFrame: number;
  endFrame: number;
  cameraFit?: CameraFit;
  transparent?: boolean;
}
export interface RenderJob extends RenderSettings {
  id: string;
  /** Output filename prefix, separate from the internal job identity. */
  fileName?: string;
  contentId: string;
}
export interface FrameContext {
  frame: number;
  time: number;
  delta: number;
  signal: AbortSignal;
}
/** Per-run cooperative cancellation and cleanup for partially acquired resources.
 * Deferred callbacks run once, in reverse order, after finish/restore. They should
 * release only resources they own, and tolerate any earlier normal cleanup.
 */
export interface PreparationContext {
  readonly signal: AbortSignal;
  defer(cleanup: () => void | Promise<void>): void;
}
/** The application owns scene time. acquire() must stop all writers of animated state. */
export interface AnimationAdapter {
  acquire(context?: PreparationContext): unknown | Promise<unknown>;
  seek(context: FrameContext): void | Promise<void>;
  ready?(context: FrameContext): void | Promise<void>;
  restore(snapshot: unknown): void | Promise<void>;
}
export interface CapturedFrame {
  /** Top-left origin, display-ready sRGB, straight RGBA8. Valid until next capture. */
  pixels: Uint8Array;
  width: number;
  height: number;
}
export interface CaptureAdapter {
  /** Optional read-only preflight, before destination opening or scene acquisition. */
  check?(
    settings: RenderSettings,
    context: Pick<PreparationContext, "signal">,
  ): void | Promise<void>;
  prepare(
    settings: RenderSettings,
    context?: PreparationContext,
  ): void | Promise<void>;
  capture(context: FrameContext): Promise<CapturedFrame>;
  finish(): void | Promise<void>;
  dispose(): void | Promise<void>;
}
export interface RenderDestination {
  /** Validate before acquiring scene. Return durably saved frame indices, if resumable. */
  open(job: RenderJob, signal: AbortSignal): Promise<ReadonlySet<number>>;
  write(frame: CapturedFrame, context: FrameContext): Promise<void>;
  close(): Promise<void>;
  abort(reason: unknown): Promise<void>;
}
export type SessionState =
  | "idle"
  | "preparing"
  | "rendering"
  | "paused"
  | "cancelling"
  | "completed"
  | "cancelled"
  | "failed"
  | "disposed";
export interface Progress {
  state: SessionState;
  completed: number;
  total: number;
  frame?: number;
  elapsedMs: number;
  etaMs?: number;
  error?: string;
}
export interface SessionOptions {
  animation: AnimationAdapter;
  capture: CaptureAdapter;
}
