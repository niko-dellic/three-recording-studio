import { RenderComponent } from "./component.js";
import type { RenderPanelOptions } from "./types.js";
import type { RenderController } from "../core/controller.js";
export interface RenderProgressOptions extends Pick<
  RenderPanelOptions,
  "container" | "theme"
> {
  controller: RenderController;
}
export class RenderProgress extends RenderComponent {
  readonly element: HTMLElement;
  private bar: HTMLProgressElement;
  private status: HTMLElement;
  constructor(options: RenderProgressOptions) {
    super(options);
    const doc = options.container.ownerDocument;
    this.element = doc.createElement("div");
    this.element.className = "trs-panel trs-component trs-progress";
    this.bar = doc.createElement("progress");
    this.bar.setAttribute("aria-label", "Render progress");
    this.status = doc.createElement("output");
    this.status.className = "trs-status";
    this.status.setAttribute("aria-live", "polite");
    this.element.append(this.bar, this.status);
    options.container.append(this.element);
    this.cleanup.push(
      options.controller.subscribe(() => {
        const progress = options.controller.status;
        this.bar.max = Math.max(1, progress.total);
        this.bar.value = progress.completed;
        const elapsed = (progress.elapsedMs / 1000).toFixed(1),
          eta =
            progress.etaMs === undefined
              ? ""
              : ` · ~${Math.ceil(progress.etaMs / 1000)}s remaining`;
        this.status.textContent =
          options.controller.error ??
          progress.error ??
          `${progress.state} · ${progress.completed} / ${progress.total} frames · ${elapsed}s${eta}`;
      }),
    );
    this.setTheme(options.theme ?? {});
  }
}
