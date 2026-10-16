import { RenderSession } from "../core/session.js";
import type {
  CapturedFrame,
  RenderDestination,
  RenderJob,
  Progress,
} from "../core/types.js";
import { putPixels } from "../destinations/pixels.js";
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
  container: HTMLElement;
  session: RenderSession;
  job: RenderJob;
  destination: (
    job: RenderJob,
  ) => RenderDestination | Promise<RenderDestination>;
  mode?: "embedded" | "floating";
  allowFloating?: boolean;
  imageDestination?: (
    job: RenderJob,
  ) => RenderDestination | undefined | Promise<RenderDestination | undefined>;
  /** Return the current animation frame for still rendering. */
  currentFrame?: () => number;
  theme?: RenderTheme;
  icons?: Partial<
    Record<
      | "render"
      | "pause"
      | "cancel"
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
export class RenderPanel {
  readonly element: HTMLElement;
  readonly previewElement: HTMLElement;
  private canvas: HTMLCanvasElement;
  private viewport: HTMLElement;
  private controls: HTMLFormElement;
  private status: HTMLElement;
  private bar: HTMLProgressElement;
  private renderButton: HTMLButtonElement;
  private previewButton: HTMLButtonElement;
  private pauseButton: HTMLButtonElement;
  private cancelButton: HTMLButtonElement;
  private fields = new Map<string, HTMLInputElement | HTMLSelectElement>();
  private cleanup: Array<() => void> = [];
  private controller = new AbortController();
  private observer: ResizeObserver;
  private scale = 1;
  private zoomOutput: HTMLOutputElement;
  private offset = { x: 0, y: 0 };
  private fitting = true;
  private mode: "embedded" | "floating";
  private lastFrame?: number;
  private video: HTMLVideoElement;
  private image: HTMLImageElement;
  private channels: HTMLSelectElement;
  private downloadButton: HTMLButtonElement;
  private newChannelButton: HTMLButtonElement;
  private stillButton: HTMLButtonElement;
  private artifacts: Array<{
    channel: string;
    url: string;
    filename: string;
    type: string;
  }> = [];
  private operation = false;
  constructor(private readonly options: RenderPanelOptions) {
    const doc = options.container.ownerDocument;
    this.element = doc.createElement("section");
    this.element.className = "trs-panel";
    this.element.setAttribute("aria-label", "Render settings");
    this.mode = options.mode ?? "embedded";
    this.element.dataset.mode = this.mode;
    const heading = doc.createElement("header");
    heading.className = "trs-header";
    const title = doc.createElement("strong");
    title.textContent = "Render output";
    heading.append(title);
    const float = this.button("Float panel", "float", () => {
      this.mode = this.mode === "floating" ? "embedded" : "floating";
      this.element.dataset.mode = this.mode;
      float.setAttribute("aria-pressed", String(this.mode === "floating"));
    });
    if (options.allowFloating !== false) heading.append(float);
    this.controls = doc.createElement("form");
    this.controls.className = "trs-controls";
    this.field("width", "Width", options.job.width);
    this.field("height", "Height", options.job.height);
    this.field("fps", "Frames / second", options.job.fps);
    this.field("startFrame", "First frame", options.job.startFrame);
    this.field("endFrame", "Last frame", options.job.endFrame);
    this.select(
      "cameraFit",
      "Camera fit",
      ["auto", "horizontal", "vertical"],
      options.job.cameraFit ?? "auto",
    );
    const transparent = this.field(
      "transparent",
      "Transparent background",
      options.job.transparent ?? false,
    );
    transparent.addEventListener("change", () => {}, {
      signal: this.controller.signal,
    });
    this.field("id", "Job ID", options.job.id);
    const actions = doc.createElement("div");
    actions.className = "trs-actions";
    this.renderButton = this.button("Render", "render", () => {
      void this.start();
    });
    this.pauseButton = this.button("Pause", "pause", () => {
      if (options.session.status.state === "paused") options.session.resume();
      else options.session.pause();
    });
    this.cancelButton = this.button("Cancel", "cancel", () =>
      options.session.cancel(),
    );
    this.previewButton = this.button("Preview frame", undefined, () => {
      void this.preview();
    });
    this.stillButton = this.button("Render image", undefined, () => {
      void this.renderImage();
    });
    actions.append(
      this.stillButton,
      this.renderButton,
      this.previewButton,
      this.pauseButton,
      this.cancelButton,
    );
    this.bar = doc.createElement("progress");
    this.bar.max = 1;
    this.bar.value = 0;
    this.bar.setAttribute("aria-label", "Render progress");
    this.status = doc.createElement("output");
    this.status.className = "trs-status";
    this.status.setAttribute("aria-live", "polite");
    this.element.append(heading, this.controls, actions, this.bar, this.status);
    options.container.append(this.element);
    this.previewElement = doc.createElement("section");
    this.previewElement.className = "trs-preview trs-panel";
    this.previewElement.setAttribute("aria-label", "Render preview");
    const tools = doc.createElement("div");
    tools.className = "trs-preview-tools";
    tools.append(
      this.button("Fit", "fit", () => this.fit()),
      this.button("100%", "actualSize", () => {
        this.fitting = false;
        this.scale = 1 / (doc.defaultView?.devicePixelRatio ?? 1);
        this.offset = { x: 0, y: 0 };
        this.transform();
      }),
    );
    this.zoomOutput = doc.createElement("output");
    this.zoomOutput.className = "trs-zoom";
    this.zoomOutput.setAttribute("aria-label", "Preview zoom");
    this.zoomOutput.title = "100% = one image pixel per display pixel";
    tools.append(this.zoomOutput);
    this.viewport = doc.createElement("div");
    this.viewport.className = "trs-viewport";
    this.viewport.tabIndex = 0;
    this.viewport.setAttribute(
      "aria-label",
      "Preview: arrows pan, plus and minus zoom, zero fits",
    );
    this.canvas = doc.createElement("canvas");
    this.canvas.width = options.job.width;
    this.canvas.height = options.job.height;
    this.canvas.className = "trs-image";
    this.canvas.setAttribute("aria-label", "Latest completed render frame");
    this.video = doc.createElement("video");
    this.video.controls = true;
    this.video.addEventListener("loadedmetadata", () => this.updateZoom(), {
      signal: this.controller.signal,
    });
    this.video.playsInline = true;
    this.video.className = "trs-result-video";
    this.video.hidden = true;
    this.video.setAttribute("aria-label", "Rendered animation");
    this.image = doc.createElement("img");
    this.image.className = "trs-image";
    this.image.alt = "Saved render";
    this.image.hidden = true;
    this.viewport.append(this.canvas, this.video, this.image);
    const slotTools = doc.createElement("div");
    slotTools.className = "trs-slot-tools";
    this.channels = doc.createElement("select");
    this.channels.setAttribute("aria-label", "Render channel");
    this.channels.add(new Option("Channel 1", "1"));
    this.newChannelButton = this.button("New channel", "newChannel", () => {
      const id = String(this.channels.options.length + 1);
      this.channels.add(new Option(`Channel ${id}`, id));
      this.channels.value = id;
      this.refreshResults();
    });
    this.channels.onchange = () => this.refreshResults();
    const remove = this.button("Delete render", "delete", () => {
      if (
        !this.artifacts.some((artifact) => artifact.channel === this.channel) ||
        this.options.session.busy ||
        this.operation
      )
        return;
      const index = this.artifacts.findIndex(
        (artifact) => artifact.channel === this.channel,
      );
      const [artifact] = this.artifacts.splice(index, 1);
      this.video.pause();
      URL.revokeObjectURL(artifact.url);
      this.refreshResults();
    });
    this.downloadButton = this.button("Download", "download", () => {
      const artifact = this.artifacts.find(
        (artifact) => artifact.channel === this.channel,
      );
      if (!artifact) return;
      const link = doc.createElement("a");
      link.href = artifact.url;
      link.download = artifact.filename;
      link.click();
    });
    this.downloadButton.disabled = true;
    slotTools.append(
      this.channels,
      this.newChannelButton,
      this.downloadButton,
      remove,
      tools,
    );
    this.previewElement.append(slotTools, this.viewport);
    (options.previewContainer ?? this.element).append(this.previewElement);
    this.setupToolbarTooltips();
    this.setupNavigation();
    this.setupDragging(heading);
    this.observer = new ResizeObserver(() => {
      if (this.fitting) this.fit();
      else this.updateZoom();
    });
    this.observer.observe(this.viewport);
    this.cleanup.push(
      options.session.subscribe((p) => this.update(p)),
      options.session.onFrame((frame, index) => this.showFrame(frame, index)),
    );
    this.controls.addEventListener(
      "submit",
      (event) => event.preventDefault(),
      { signal: this.controller.signal },
    );
    this.setTheme(options.theme ?? {});
  }
  private button(
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
        render: "M7 4l12 8-12 8z",
        pause: "M8 5v14M16 5v14",
        cancel: "M6 6h12v12H6z",
        actualSize: "M8 3H5v18h3M16 3h3v18h-3M10 8h2v8M10 16h4",
        fit: "M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5",
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
        ["newChannel", "download", "delete", "fit", "actualSize"].includes(icon)
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
  private setupToolbarTooltips() {
    let tooltip: HTMLElement | undefined;
    let anchor: HTMLButtonElement | undefined;
    const hide = () => {
      anchor?.removeAttribute("aria-describedby");
      tooltip?.remove();
      tooltip = undefined;
      anchor = undefined;
    };
    const show = (event: Event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>(
        ".trs-slot-tools button",
      );
      if (!button || anchor === button) return;
      hide();
      anchor = button;
      const doc = button.ownerDocument;
      const win = doc.defaultView!;
      tooltip = doc.createElement("div");
      tooltip.className = "trs-tooltip";
      tooltip.id = `trs-tooltip-${Math.random().toString(36).slice(2)}`;
      tooltip.setAttribute("role", "tooltip");
      tooltip.setAttribute("popover", "manual");
      tooltip.textContent =
        button.getAttribute("aria-label") === "100%"
          ? "Actual size (100%)"
          : button.getAttribute("aria-label");
      button.removeAttribute("title");
      button.setAttribute("aria-describedby", tooltip.id);
      const colors = win.getComputedStyle(this.previewElement);
      for (const key of ["surface", "text", "border"])
        tooltip.style.setProperty(
          `--trs-${key}`,
          colors.getPropertyValue(`--trs-${key}`),
        );
      doc.body.append(tooltip);
      tooltip.showPopover?.();
      const rect = button.getBoundingClientRect();
      const box = tooltip.getBoundingClientRect();
      tooltip.style.left = `${Math.max(8, Math.min(rect.left + (rect.width - box.width) / 2, win.innerWidth - box.width - 8))}px`;
      tooltip.style.top = `${rect.bottom + box.height + 8 < win.innerHeight ? rect.bottom + 6 : rect.top - box.height - 6}px`;
    };
    const root = this.previewElement;
    const options = { signal: this.controller.signal };
    root.addEventListener("pointerover", show, options);
    root.addEventListener("focusin", show, options);
    root.addEventListener("pointerout", hide, options);
    root.addEventListener("focusout", hide, options);
    root.addEventListener("pointerdown", hide, options);
    root.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") hide();
      },
      options,
    );
    this.cleanup.push(hide);
  }
  private field(key: string, label: string, value: string | number | boolean) {
    const doc = this.element.ownerDocument,
      wrapper = doc.createElement("label"),
      input = doc.createElement("input");
    wrapper.textContent = label;
    input.name = key;
    input.type =
      typeof value === "boolean"
        ? "checkbox"
        : typeof value === "number"
          ? "number"
          : "text";
    if (typeof value === "boolean") input.checked = value;
    else input.value = String(value);
    if (typeof value === "number") {
      input.min = ["width", "height", "fps"].includes(key) ? "1" : "0";
      input.step = key === "fps" ? "any" : "1";
    }
    wrapper.append(input);
    this.controls.append(wrapper);
    this.fields.set(key, input);
    return input;
  }
  private select(key: string, label: string, values: string[], value: string) {
    const doc = this.element.ownerDocument,
      wrapper = doc.createElement("label"),
      select = doc.createElement("select");
    wrapper.textContent = label;
    select.name = key;
    for (const text of values) {
      const option = doc.createElement("option");
      option.value = text;
      option.textContent = text;
      select.append(option);
    }
    select.value = value;
    wrapper.append(select);
    this.controls.append(wrapper);
    this.fields.set(key, select);
  }
  getJob(): RenderJob {
    const job = { ...this.options.job };
    for (const [key, input] of this.fields) {
      (job as unknown as Record<string, unknown>)[key] =
        input instanceof HTMLInputElement && input.type === "checkbox"
          ? input.checked
          : ["width", "height", "fps", "startFrame", "endFrame"].includes(key)
            ? Number(input.value)
            : input.value;
    }
    return job;
  }
  async start() {
    if (this.options.session.busy || this.operation) return;
    this.operation = true;
    this.update(this.options.session.status);
    try {
      const job = this.getJob();
      await this.options.session.start(
        job,
        await this.options.destination(job),
      );
    } catch (error) {
      this.operation = false;
      this.update(this.options.session.status);
      this.status.textContent = String(error);
      return;
    } finally {
      if (this.operation) {
        this.operation = false;
        this.update(this.options.session.status);
      }
    }
  }
  async preview() {
    if (this.options.session.busy) return;
    try {
      await this.options.session.preview(
        this.getJob(),
        this.options.currentFrame?.(),
      );
    } catch (error) {
      this.status.textContent = String(error);
    }
  }
  private update(progress: Progress) {
    const busy =
      this.operation ||
      ["preparing", "rendering", "paused", "cancelling"].includes(
        progress.state,
      );
    if (["failed", "cancelled"].includes(progress.state) && !busy)
      this.displayResult();
    this.channels.disabled = busy;
    this.newChannelButton.disabled = busy;
    this.stillButton.disabled = busy;
    for (const field of this.fields.values()) field.disabled = busy;
    this.renderButton.disabled = busy;
    this.previewButton.disabled = busy;
    this.pauseButton.disabled = !busy || progress.state === "cancelling";
    this.cancelButton.disabled = !busy;
    this.pauseButton.textContent =
      progress.state === "paused" ? "Resume" : "Pause";
    this.pauseButton.setAttribute("aria-label", this.pauseButton.textContent);
    this.bar.max = Math.max(1, progress.total);
    this.bar.value = progress.completed;
    const elapsed = (progress.elapsedMs / 1000).toFixed(1),
      eta =
        progress.etaMs === undefined
          ? ""
          : ` · ~${Math.ceil(progress.etaMs / 1000)}s remaining`;
    this.status.textContent =
      progress.error ??
      `${progress.state} · ${progress.completed} / ${progress.total} frames · ${elapsed}s${eta}`;
  }
  get channel(): string {
    return this.channels.value;
  }
  /** Retain a completed render in its channel. Nothing is downloaded automatically. */
  addResult(blob: Blob, filename: string, channel = this.channel) {
    if (this.controller.signal.aborted) return;
    const previous = this.artifacts.findIndex(
      (artifact) => artifact.channel === channel,
    );
    if (previous >= 0) {
      const [replaced] = this.artifacts.splice(previous, 1);
      URL.revokeObjectURL(replaced.url);
    }
    this.artifacts.push({
      channel,
      filename,
      type: blob.type,
      url: URL.createObjectURL(blob),
    });
    if (channel === this.channel) this.refreshResults();
  }
  private refreshResults() {
    this.displayResult();
  }
  private displayResult() {
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    const artifact = this.artifacts.find(
      (artifact) => artifact.channel === this.channel,
    );
    this.downloadButton.disabled = !artifact;
    this.canvas.hidden = !!artifact;
    this.video.hidden = !artifact?.type.startsWith("video/");
    this.setVideoTools(!this.video.hidden);
    this.image.hidden = !artifact?.type.startsWith("image/");
    this.updateZoom();
    if (!artifact) {
      this.canvas
        .getContext("2d")!
        .clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.image.removeAttribute("src");
      return;
    }
    if (artifact.type.startsWith("video/")) this.video.src = artifact.url;
    else {
      this.image.onload = () => this.fit();
      this.image.src = artifact.url;
    }
  }
  async renderImage() {
    if (this.options.session.busy || this.operation) return;
    this.operation = true;
    this.update(this.options.session.status);
    const channel = this.channel;
    try {
      const job = this.getJob();
      const frame = this.options.currentFrame?.() ?? job.startFrame;
      const stillJob = { ...job, startFrame: frame, endFrame: frame };
      const destination = await this.options.imageDestination?.(stillJob);
      let image: CapturedFrame | undefined;
      if (destination) {
        await this.options.session.start(stillJob, {
          open: (job, signal) => destination.open(job, signal),
          async write(value, context) {
            await destination.write(value, context);
            image = { ...value, pixels: value.pixels.slice() };
          },
          close: () => destination.close(),
          abort: (reason) => destination.abort(reason),
        });
        if (this.options.session.status.state !== "completed") return;
      } else image = await this.options.session.preview(stillJob, frame);
      if (!image) return;
      const canvas = this.element.ownerDocument.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      putPixels(canvas.getContext("2d")!, image);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error("PNG encoding failed")),
          "image/png",
        ),
      );
      this.addResult(blob, `${job.id}-frame-${frame}.png`, channel);
    } catch (error) {
      this.operation = false;
      this.update(this.options.session.status);
      this.status.textContent = String(error);
      return;
    } finally {
      if (this.operation) {
        this.operation = false;
        this.update(this.options.session.status);
      }
    }
  }
  private setVideoTools(video: boolean) {
    const tools =
      this.previewElement.querySelector<HTMLElement>(".trs-preview-tools")!;
    for (const button of tools.querySelectorAll("button"))
      button.disabled = video;
  }
  showFrame(frame: CapturedFrame, index?: number) {
    this.setVideoTools(false);
    this.video.pause();
    this.video.hidden = true;
    this.image.hidden = true;
    this.canvas.hidden = false;
    this.downloadButton.disabled = true;
    const resized =
      this.canvas.width !== frame.width || this.canvas.height !== frame.height;
    if (resized) {
      this.canvas.width = frame.width;
      this.canvas.height = frame.height;
    }
    putPixels(this.canvas.getContext("2d")!, frame);
    this.lastFrame = index;
    this.canvas.setAttribute(
      "aria-label",
      `Rendered frame ${index ?? "preview"}, ${frame.width} by ${frame.height}`,
    );
    if (this.fitting || resized) this.fit();
  }
  fit() {
    this.fitting = true;
    this.offset = { x: 0, y: 0 };
    this.scale = Math.max(
      0.001,
      Math.min(
        (this.viewport.clientWidth - 32) /
          (!this.image.hidden
            ? this.image.naturalWidth || this.canvas.width
            : this.canvas.width),
        (this.viewport.clientHeight - 32) /
          (!this.image.hidden
            ? this.image.naturalHeight || this.canvas.height
            : this.canvas.height),
      ),
    );
    this.transform();
  }
  private updateZoom() {
    let scale = this.scale;
    if (!this.video.hidden) {
      if (!this.video.videoWidth || !this.video.videoHeight) {
        this.zoomOutput.value = "—";
        return;
      }
      scale = Math.min(
        this.viewport.clientWidth / this.video.videoWidth,
        this.viewport.clientHeight / this.video.videoHeight,
      );
    }
    const percent =
      scale *
      (this.element.ownerDocument.defaultView?.devicePixelRatio ?? 1) *
      100;
    this.zoomOutput.value = `${Number(percent.toFixed(1))}%`;
  }
  private transform() {
    this.updateZoom();
    this.image.style.transform =
      this.canvas.style.transform = `translate(calc(-50% + ${this.offset.x}px), calc(-50% + ${this.offset.y}px)) scale(${this.scale})`;
  }
  private zoom(factor: number, x = 0, y = 0) {
    const next = Math.min(16, Math.max(0.01, this.scale * factor)),
      ratio = next / this.scale;
    this.offset = {
      x: x - (x - this.offset.x) * ratio,
      y: y - (y - this.offset.y) * ratio,
    };
    this.scale = next;
    this.fitting = false;
    this.transform();
  }
  private setupNavigation() {
    const signal = this.controller.signal;
    let drag: { x: number; y: number } | undefined;
    this.viewport.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const bounds = this.viewport.getBoundingClientRect();
        this.zoom(
          Math.exp(-event.deltaY * 0.002),
          event.clientX - bounds.left - bounds.width / 2,
          event.clientY - bounds.top - bounds.height / 2,
        );
      },
      { signal, passive: false },
    );
    this.viewport.addEventListener(
      "pointerdown",
      (event) => {
        if (event.button !== 0 || event.target === this.video) return;
        drag = { x: event.clientX, y: event.clientY };
        this.viewport.setPointerCapture(event.pointerId);
        this.viewport.focus();
      },
      { signal },
    );
    this.viewport.addEventListener(
      "pointermove",
      (event) => {
        if (!drag) return;
        this.fitting = false;
        this.offset.x += event.clientX - drag.x;
        this.offset.y += event.clientY - drag.y;
        drag = { x: event.clientX, y: event.clientY };
        this.transform();
      },
      { signal },
    );
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
      this.viewport.addEventListener(
        event,
        () => {
          drag = undefined;
        },
        { signal },
      );
    this.viewport.addEventListener(
      "keydown",
      (event) => {
        if (
          [
            "+",
            "=",
            "-",
            "0",
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
          ].includes(event.key)
        ) {
          event.preventDefault();
          if (event.key === "0") this.fit();
          else if (event.key === "+" || event.key === "=") this.zoom(1.2);
          else if (event.key === "-") this.zoom(1 / 1.2);
          else {
            this.fitting = false;
            this.offset.x +=
              event.key === "ArrowLeft"
                ? -20
                : event.key === "ArrowRight"
                  ? 20
                  : 0;
            this.offset.y +=
              event.key === "ArrowUp"
                ? -20
                : event.key === "ArrowDown"
                  ? 20
                  : 0;
            this.transform();
          }
        }
      },
      { signal },
    );
  }
  private setupDragging(header: HTMLElement) {
    let drag: { x: number; y: number; left: number; top: number } | undefined;
    const signal = this.controller.signal;
    header.addEventListener(
      "pointerdown",
      (event) => {
        if (
          this.mode !== "floating" ||
          (event.target as HTMLElement).closest("button")
        )
          return;
        const rect = this.element.getBoundingClientRect();
        drag = {
          x: event.clientX,
          y: event.clientY,
          left: rect.left,
          top: rect.top,
        };
        header.setPointerCapture(event.pointerId);
      },
      { signal },
    );
    header.addEventListener(
      "pointermove",
      (event) => {
        if (!drag) return;
        this.element.style.left = `${Math.max(0, drag.left + event.clientX - drag.x)}px`;
        this.element.style.top = `${Math.max(0, drag.top + event.clientY - drag.y)}px`;
      },
      { signal },
    );
    header.addEventListener(
      "pointerup",
      () => {
        drag = undefined;
      },
      { signal },
    );
    header.addEventListener(
      "pointercancel",
      () => {
        drag = undefined;
      },
      { signal },
    );
  }
  setTheme(theme: RenderTheme) {
    for (const name of Object.keys(theme) as Array<keyof RenderTheme>)
      for (const element of [this.element, this.previewElement])
        element.style.setProperty(`--trs-${name}`, theme[name]!);
  }
  dispose() {
    this.controller.abort();
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    for (const artifact of this.artifacts) URL.revokeObjectURL(artifact.url);
    this.artifacts = [];
    this.observer.disconnect();
    for (const cleanup of this.cleanup) cleanup();
    this.element.remove();
    this.previewElement.remove();
  }
}
