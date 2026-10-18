import type { RenderCapabilities } from "./capabilities.js";
export type CameraFit = "auto" | "horizontal" | "vertical";
export interface RenderSettings {
  width: number;
  height: number;
  /** Multiplies base dimensions once at execution; defaults to 1. */
  resolutionMultiplier?: number;
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
  /** Discover constraints without allocating per-render resources. */
  capabilities?(
    context: Pick<PreparationContext, "signal">,
  ): RenderCapabilities | Promise<RenderCapabilities>;
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
  capabilities?(
    context: Pick<PreparationContext, "signal">,
  ): RenderCapabilities | Promise<RenderCapabilities>;
  /** Read-only validation. Must not prompt, write files, or open network sessions. */
  check?(
    job: RenderJob,
    context: Pick<PreparationContext, "signal">,
  ): void | Promise<void>;
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
export type RenderPhase =
  | "preflight"
  | "open"
  | "acquire"
  | "prepare"
  | "seek"
  | "ready"
  | "capture"
  | "write"
  | "finalize"
  | "abort"
  | "finish"
  | "restore"
  | "cleanup";
export interface RenderDiagnostic {
  readonly code: "INVALID_FRAME" | "RENDER_FAILED" | "CLEANUP_FAILED";
  readonly phase: RenderPhase;
  readonly jobId: string;
  readonly frame?: number;
  readonly message: string;
}
export interface Progress {
  state: SessionState;
  completed: number;
  total: number;
  frame?: number;
  elapsedMs: number;
  etaMs?: number;
  error?: string;
  /** Structured failures; error remains the backwards-compatible display string. */
  diagnostics?: readonly RenderDiagnostic[];
}
export interface SessionOptions {
  animation: AnimationAdapter;
  capture: CaptureAdapter;
}
