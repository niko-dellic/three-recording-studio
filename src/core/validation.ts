import { resolveResolution } from "./resolution.js";
import type { RenderJob } from "./types.js";
export function validateJob(job: RenderJob): void {
  resolveResolution(job);
  for (const key of ["width", "height", "startFrame", "endFrame"] as const) {
    if (
      !Number.isSafeInteger(job[key]) ||
      job[key] < (key === "width" || key === "height" ? 1 : 0)
    )
      throw new Error(`Invalid ${key}`);
  }
  if (!Number.isFinite(job.fps) || job.fps <= 0 || job.fps > 240)
    throw new Error("FPS must be between 0 and 240");
  if (
    job.sampleIntervalSeconds !== undefined &&
    (!Number.isFinite(job.sampleIntervalSeconds) ||
      job.sampleIntervalSeconds <= 0)
  )
    throw new Error(
      "Sample interval must be a positive finite number of seconds",
    );
  if (
    !Number.isFinite(job.endFrame * (job.sampleIntervalSeconds ?? 1 / job.fps))
  )
    throw new Error("Scene time must be finite");
  if (job.endFrame < job.startFrame)
    throw new Error("End frame precedes start frame");
  if (job.fileName !== undefined && !/^[a-zA-Z0-9_-]{1,80}$/.test(job.fileName))
    throw new Error("Invalid file name");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(job.id) || !job.contentId.trim())
    throw new Error("Supply a safe job ID and nonempty contentId");
  if (
    job.cameraFit &&
    !["auto", "horizontal", "vertical"].includes(job.cameraFit)
  )
    throw new Error("Invalid camera fit");
}
