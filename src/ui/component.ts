import type { RenderPanelOptions, RenderTheme } from "./types.js";
/** Small shared lifetime and styling owner. Disposing a view never disposes a session. */
export abstract class RenderComponent {
  abstract readonly element: HTMLElement;
  protected controller = new AbortController();
  protected cleanup: Array<() => void> = [];
  constructor(
    protected readonly options: Pick<
      RenderPanelOptions,
      "container" | "icons" | "renderIcon" | "theme"
    >,
  ) {}
  protected button(
    label: string,
    icon: keyof NonNullable<RenderPanelOptions["icons"]> | undefined,
    action: () => void,
  ) {
    const button = this.options.container.ownerDocument.createElement("button");
    button.type = "button";
    button.textContent =
      icon && this.options.icons?.[icon]
        ? `${this.options.icons[icon]} ${label}`
        : label;
    if (icon && !this.options.icons?.[icon]) {
      const paths = {
        newChannel: "M12 5v14M5 12h14",
        download:
          "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
        delete: "M3 6h18M19 6v14H5V6M9 6V3h6v3M10 10v6M14 10v6",
        render:
          "m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z",
        renderImage:
          "M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4ZM15 13a3 3 0 1 0-6 0a3 3 0 1 0 6 0",
        fullscreen:
          "M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M3 16v3a2 2 0 0 0 2 2h3",
        exitFullscreen:
          "M8 3v3a2 2 0 0 1-2 2H3M16 3v3a2 2 0 0 0 2 2h3M21 16h-3a2 2 0 0 0-2 2v3M3 16h3a2 2 0 0 1 2 2v3",
        pause: "M8 5v14M16 5v14",
        resume: "M6 3l14 9-14 9z",
        cancel: "M6 6h12v12H6z",
        actualSize:
          "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM7 10h10M7 14h10",
        fit: "M15 12a3 3 0 1 0-6 0a3 3 0 1 0 6 0M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2",
        float: "M8 3h13v13M21 3L10 14M3 8v13h13",
      };
      const svg = this.element.ownerDocument.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg",
      );
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      svg.classList.add("trs-icon");
      const path = this.element.ownerDocument.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      path.setAttribute("d", paths[icon]);
      svg.append(path);
      button.prepend(svg);
    }
    if (icon) {
      const custom = this.options.renderIcon?.(icon, button.ownerDocument);
      if (custom) {
        button.querySelector("svg")?.remove();
        custom.classList.add("trs-icon");
        custom.setAttribute("aria-hidden", "true");
        button.prepend(custom);
      }
      if (
        [
          "newChannel",
          "download",
          "delete",
          "fit",
          "actualSize",
          "fullscreen",
          "exitFullscreen",
          "render",
          "renderImage",
          "pause",
          "resume",
          "cancel",
        ].includes(icon)
      ) {
        const graphic = button.querySelector("svg");
        if (graphic) {
          button.replaceChildren(graphic);
          button.classList.add("trs-icon-button");
        }
      }
    }
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", action, {
      signal: this.controller.signal,
    });
    return button;
  }

  setTheme(theme: RenderTheme) {
    for (const [name, value] of Object.entries(theme as Record<string, string>))
      this.element.style.setProperty(`--trs-${name}`, value!);
  }
  dispose() {
    this.controller.abort();
    for (const cleanup of this.cleanup.splice(0)) cleanup();
    this.element.remove();
  }
}
