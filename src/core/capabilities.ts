import type { CaptureAdapter, RenderDestination, RenderJob } from "./types.js";
import { validateJob } from "./validation.js";
import { resolveRenderSettings } from "./resolution.js";

/** Missing fields are unknown, not evidence of support. */
export interface RenderCapabilities {
  readonly transparent?: boolean;
  readonly cameraFit?: boolean;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly widthMultiple?: number;
  readonly heightMultiple?: number;
  readonly maxFrames?: number;
  readonly memoryLimitBytes?: number;
  readonly resumable?: boolean;
}
export interface PreflightIssue {
  readonly source: "settings" | "capture" | "destination";
  readonly message: string;
}
export interface PreflightReport {
  readonly valid: boolean;
  readonly job?: Readonly<RenderJob>;
  readonly capture: RenderCapabilities;
  readonly destination: RenderCapabilities;
  readonly issues: readonly PreflightIssue[];
}
export class PreflightError extends Error {
  constructor(readonly report: PreflightReport) {
    super(
      report.issues
        .map((issue) => `${issue.source}: ${issue.message}`)
        .join("; "),
    );
    this.name = "PreflightError";
  }
}

function constraints(
  job: RenderJob,
  capabilities: RenderCapabilities,
): string[] {
  const issues: string[] = [];
  if (job.transparent && capabilities.transparent === false)
    issues.push(
      "Transparent output is unsupported; choose opaque output or another format",
    );
  if (
    job.cameraFit &&
    job.cameraFit !== "auto" &&
    capabilities.cameraFit === false
  )
    issues.push("Camera fitting is controlled by the application");
  for (const axis of ["width", "height"] as const) {
    const max = capabilities[axis === "width" ? "maxWidth" : "maxHeight"];
    const multiple =
      capabilities[axis === "width" ? "widthMultiple" : "heightMultiple"];
    if (max !== undefined && job[axis] > max)
      issues.push(`Output ${axis} ${job[axis]} exceeds limit ${max}`);
    if (multiple !== undefined && job[axis] % multiple !== 0)
      issues.push(`Output ${axis} must be a multiple of ${multiple}`);
  }
  if (
    capabilities.maxFrames !== undefined &&
    job.endFrame - job.startFrame + 1 > capabilities.maxFrames
  )
    issues.push(`Output exceeds ${capabilities.maxFrames} frames`);
  return issues;
}

/** Checks constraints and availability without opening storage or acquiring the scene. */
export async function inspectRender(
  input: RenderJob,
  capture: CaptureAdapter,
  destination: RenderDestination,
  signal: AbortSignal = new AbortController().signal,
): Promise<PreflightReport> {
  signal.throwIfAborted();
  const issues: PreflightIssue[] = [];
  let job: RenderJob | undefined;
  try {
    validateJob(input);
    job = resolveRenderSettings({ ...input });
  } catch (error) {
    issues.push({
      source: "settings",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const inspect = async (
    source: "capture" | "destination",
    provider: CaptureAdapter | RenderDestination,
  ): Promise<RenderCapabilities> => {
    let capabilities: RenderCapabilities = {};
    try {
      capabilities = Object.freeze({
        ...(await provider.capabilities?.({ signal })),
      });
      signal.throwIfAborted();
      if (job) {
        const invalid = constraints(job, capabilities);
        issues.push(...invalid.map((message) => ({ source, message })));
        // Constraint failures need no potentially expensive codec/device probe.
        if (!invalid.length) await provider.check?.(job, { signal });
      }
    } catch (error) {
      signal.throwIfAborted();
      issues.push({
        source,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return capabilities;
  };
  // Keep reports ordered and avoid assuming capture/device probes are reentrant.
  const captureCapabilities = await inspect("capture", capture);
  const destinationCapabilities = await inspect("destination", destination);
  signal.throwIfAborted();
  return Object.freeze({
    valid: issues.length === 0,
    job: job && Object.freeze(job),
    capture: captureCapabilities,
    destination: destinationCapabilities,
    issues: Object.freeze(issues.map((issue) => Object.freeze(issue))),
  });
}
