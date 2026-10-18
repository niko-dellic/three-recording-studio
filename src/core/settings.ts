import type { RenderSettings } from "./types.js";

/** Editable settings, independent of per-run identity and any UI framework.
 * Drafts may be incomplete/invalid while typing; validateJob validates execution.
 */
export interface RecordingSettings extends RenderSettings {
  fileName?: string;
}
export interface RecordingSettingsStore {
  /** Stable, immutable snapshot until an effective change occurs. */
  getSnapshot(): Readonly<RecordingSettings>;
  /** Changes only; consumers read the initial snapshot explicitly. */
  subscribe(listener: () => void): () => void;
  /** Atomic patch. Explicit undefined clears an optional setting. */
  updateSettings(patch: Partial<RecordingSettings>): void;
}
export function createRecordingSettings(
  initial: RecordingSettings,
): RecordingSettingsStore {
  // Explicitly select fields: callers may pass RenderJob, but job identity is
  // never editable settings and must not leak into persisted settings snapshots.
  const keys = [
    "width",
    "height",
    "resolutionMultiplier",
    "fps",
    "startFrame",
    "endFrame",
    "sampleIntervalSeconds",
    "cameraFit",
    "transparent",
    "fileName",
  ] as const;
  const select = (value: Partial<RecordingSettings>) =>
    Object.fromEntries(
      keys
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, value[key]]),
    ) as unknown as RecordingSettings;
  let snapshot: Readonly<RecordingSettings> = Object.freeze(select(initial));
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    updateSettings(patch) {
      const next = select({ ...snapshot, ...patch });
      if (keys.every((key) => Object.is(snapshot[key], next[key]))) return;
      snapshot = Object.freeze(next);
      for (const listener of [...listeners]) listener();
    },
  };
}
