import type { RenderSettings } from "./types.js";

/** Resolve base dimensions once, without changing the caller's editable settings. */
export function resolveResolution(
  settings: Pick<RenderSettings, "width" | "height" | "resolutionMultiplier">,
) {
  const multiplier = settings.resolutionMultiplier ?? 1;
  if (!Number.isFinite(multiplier) || multiplier <= 0)
    throw new Error("Resolution multiplier must be positive and finite");
  for (const value of [settings.width, settings.height])
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error("Base dimensions must be positive safe integers");
  const width = Math.round(settings.width * multiplier);
  const height = Math.round(settings.height * multiplier);
  if (
    ![width, height].every((value) => Number.isSafeInteger(value) && value > 0)
  )
    throw new Error("Scaled dimensions must be positive safe integers");
  return { width, height };
}
/** The returned execution settings are idempotent: passing them on cannot scale twice. */
export function resolveRenderSettings<T extends RenderSettings>(
  settings: T,
): T {
  const { resolutionMultiplier: _, ...base } = settings;
  return { ...base, ...resolveResolution(settings) } as T;
}
