import type { RenderResults } from "../core/results.js";
import type { RenderSession } from "../core/session.js";
import type { RenderJob, RenderDestination } from "../core/types.js";
import type { RecordingSettingsStore } from "../core/settings.js";
export type RenderTheme = Partial<
  Record<
    | "background"
    | "surface"
    | "text"
    | "muted"
    | "accent"
    | "border"
    | "radius"
    | "font"
    | "space"
    | "control-height"
    | "color-scheme",
    string
  >
>;
export interface RenderPanelOptions {
  /** Replace built-in controls without reaching into their DOM. */
  controls?: { cameraFit?: boolean; frameRange?: boolean };
  container: HTMLElement;
  session: RenderSession;
  job: RenderJob;
  /** Optional externally owned settings. UI edits and API updates share this model. */
  settings?: RecordingSettingsStore;
  /** Optional externally owned results, retained across panel disposal. */
  results?: RenderResults;
  destination: (
    job: RenderJob,
  ) => RenderDestination | Promise<RenderDestination>;
  mode?: "embedded" | "floating";
  allowFloating?: boolean;
  /** Total retained channel blobs, including PNG sequence archives. Default 256 MiB. */
  maxRetainedBytes?: number;
  imageDestination?: (
    job: RenderJob,
  ) => RenderDestination | undefined | Promise<RenderDestination | undefined>;
  /** Return the current animation frame for still rendering. */
  currentFrame?: () => number;
  theme?: RenderTheme;
  icons?: Partial<
    Record<
      | "renderImage"
      | "render"
      | "pause"
      | "resume"
      | "cancel"
      | "fullscreen"
      | "exitFullscreen"
      | "actualSize"
      | "fit"
      | "float"
      | "newChannel"
      | "download"
      | "delete",
      string
    >
  >;
  renderIcon?: (key: string, document: Document) => Element | undefined;
  /** If provided, mount the preview here while controls remain in container. */
  previewContainer?: HTMLElement;
}
