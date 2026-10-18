import { RenderComponent } from "./component.js";
import { setupTooltips } from "./tooltip.js";
import type { RenderPanelOptions } from "./types.js";
import type { RenderController } from "../core/controller.js";
export interface RenderTransportOptions extends Pick<
  RenderPanelOptions,
  "container" | "theme" | "icons" | "renderIcon"
> {
  controller: RenderController;
}
export class RenderTransport extends RenderComponent {
  readonly element: HTMLElement;
  private renderButton: HTMLButtonElement;
  private stillButton: HTMLButtonElement;
  private pauseButton: HTMLButtonElement;
  private cancelButton: HTMLButtonElement;
  constructor(private readonly viewOptions: RenderTransportOptions) {
    super(viewOptions);
    const recording = viewOptions.controller;
    this.element = viewOptions.container.ownerDocument.createElement("div");
    this.element.className = "trs-panel trs-component trs-actions";
    this.renderButton = this.button("Render", "render", () => {
      void recording.start().catch(() => {});
    });
    this.stillButton = this.button("Render image", "renderImage", () => {
      void recording.renderImage().catch(() => {});
    });
    this.pauseButton = this.button("Pause", "pause", () =>
      recording.status.state === "paused"
        ? recording.session.resume()
        : recording.session.pause(),
    );
    this.cancelButton = this.button("Cancel", "cancel", () =>
      recording.session.cancel(),
    );
    this.element.append(
      this.stillButton,
      this.renderButton,
      this.pauseButton,
      this.cancelButton,
    );
    viewOptions.container.append(this.element);
    this.cleanup.push(
      setupTooltips(this.element, "button", this.controller.signal),
      recording.subscribe(() => this.update()),
    );
    this.setTheme(viewOptions.theme ?? {});
  }
  private update() {
    const recording = this.viewOptions.controller,
      progress = recording.status;
    this.stillButton.disabled = recording.busy;
    this.renderButton.disabled =
      recording.busy || recording.inspection?.valid === false;
    this.pauseButton.disabled =
      !recording.busy || progress.state === "cancelling";
    this.cancelButton.disabled = !recording.busy;
    const pauseLabel = progress.state === "paused" ? "Resume" : "Pause";
    if (this.pauseButton.getAttribute("aria-label") !== pauseLabel) {
      const icon = progress.state === "paused" ? "resume" : "pause";
      const doc = this.element.ownerDocument;
      let graphic = this.options.renderIcon?.(icon, doc);
      if (!graphic) {
        graphic = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        graphic.setAttribute("viewBox", "0 0 24 24");
        const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute(
          "d",
          icon === "resume" ? "M6 3l14 9-14 9z" : "M8 5v14M16 5v14",
        );
        graphic.append(path);
      }
      graphic.classList.add("trs-icon");
      graphic.setAttribute("aria-hidden", "true");
      this.pauseButton.replaceChildren(graphic);
      this.pauseButton.setAttribute("aria-label", pauseLabel);
      const tooltipId = this.pauseButton.getAttribute("aria-describedby");
      const tooltip = tooltipId ? doc.getElementById(tooltipId) : null;
      if (tooltip) tooltip.textContent = pauseLabel;
      this.pauseButton.removeAttribute("title");
    }
  }
}
