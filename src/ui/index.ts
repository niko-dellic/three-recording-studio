import {
  createRecordingSettings,
  type RecordingSettings,
  type RecordingSettingsStore,
} from "../core/settings.js";
import type { PngSequence } from "../destinations/memory.js";
import { setupTooltips } from "./tooltip.js";
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
  /** Optional externally owned settings. UI edits and API updates share this model. */
  settings?: RecordingSettingsStore;
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
export class RenderPanel {
  readonly settings: RecordingSettingsStore;
  private settingsViews: Array<() => void> = [];
  private reflectingSettings = false;
  readonly element: HTMLElement;
  readonly previewElement: HTMLElement;
  private canvas: HTMLCanvasElement;
  private outputFrame: HTMLDivElement;
  private viewport: HTMLElement;
  private controls: HTMLFormElement;
  private status: HTMLElement;
  private bar: HTMLProgressElement;
  private renderButton: HTMLButtonElement;
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
  private fullscreenHideTimer?: number;
  private previewBeforeFullscreen?: {
    scale: number;
    offset: { x: number; y: number };
    fitting: boolean;
  };
  private mode: "embedded" | "floating";
  private lastFrame?: number;
  private video: HTMLVideoElement;
  private image: HTMLImageElement;
  private channels: HTMLSelectElement;
  private downloadButton: HTMLButtonElement;
  private stillButton: HTMLButtonElement;
  private deleteButton: HTMLButtonElement;
  private sequenceTools!: HTMLDivElement;
  private playbackAnimationFrame?: number;
  private sequenceTimer?: number;
  private artifacts: Array<{
    bytes: number;
    sequence?: { urls: string[]; fps: number };
    channel: string;
    url: string;
    filename: string;
    type: string;
  }> = [];
  private operation = false;
  private jobId = crypto.randomUUID();
  private transparencySupported = true;
  private preferredTransparency = true;
  constructor(private readonly options: RenderPanelOptions) {
    this.settings =
      options.settings ??
      createRecordingSettings({
        cameraFit: "auto",
        transparent: true,
        ...options.job,
        fileName: options.job.fileName ?? options.job.id,
      });
    options = this.options = {
      ...options,
      job: { ...options.job, ...this.settings.getSnapshot() },
    };
    const doc = options.container.ownerDocument;
    this.element = doc.createElement("section");
    this.element.className = "trs-panel";
    this.element.setAttribute("aria-label", "Render settings");
    this.mode = options.mode ?? "embedded";
    this.element.dataset.mode = this.mode;
    const heading = doc.createElement("summary");
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
    const dimensions = doc.createElement("div");
    dimensions.className = "trs-dimensions";
    for (const name of ["width", "height", "fps"])
      dimensions.append(this.fields.get(name)!.parentElement!);
    this.controls.append(dimensions);
    this.samplingSettings();
    this.frameRange(options.job.startFrame, options.job.endFrame);
    this.select(
      "cameraFit",
      "Camera fit",
      ["auto", "horizontal", "vertical"],
      options.job.cameraFit ?? "auto",
    );
    const transparent = this.field(
      "transparent",
      "Transparent",
      options.job.transparent ?? true,
    );
    transparent.addEventListener("change", () => {}, {
      signal: this.controller.signal,
    });
    this.field("fileName", "File name", options.job.fileName ?? options.job.id);
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
    this.stillButton = this.button("Render image", "renderImage", () => {
      void this.renderImage();
    });
    actions.append(
      this.stillButton,
      this.renderButton,
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
    const outputSection = doc.createElement("details");
    outputSection.className = "trs-accordion";
    outputSection.open = true;
    const templates = [
      ["HD · 1280 × 720 · 16:9", 1280, 720],
      ["Full HD · 1920 × 1080 · 16:9", 1920, 1080],
      ["QHD · 2560 × 1440 · 16:9", 2560, 1440],
      ["4K UHD · 3840 × 2160 · 16:9", 3840, 2160],
      ["Square · 1080 × 1080 · 1:1", 1080, 1080],
      ["Portrait · 1080 × 1920 · 9:16", 1080, 1920],
      ["Portrait · 1080 × 1350 · 4:5", 1080, 1350],
      ["Landscape · 1600 × 1200 · 4:3", 1600, 1200],
      ["Ultrawide · 2520 × 1080 · 21:9", 2520, 1080],
      ["Panoramic · 3840 × 1280 · 3:1", 3840, 1280],
    ] as const;
    const templateField = doc.createElement("label");
    templateField.className = "trs-outlined-field trs-template";
    const templateLabel = doc.createElement("span");
    templateLabel.textContent = "Output template";
    const templateSelect = doc.createElement("select");
    templateSelect.setAttribute("aria-label", "Output template");
    templateSelect.add(new Option("Custom", ""));
    templates.forEach(([label, width, height]) =>
      templateSelect.add(new Option(label, `${width}x${height}`)),
    );
    const widthField = this.fields.get("width")!;
    const heightField = this.fields.get("height")!;
    const orientation = doc.createElement("div");
    orientation.className = "trs-orientation";
    orientation.setAttribute("role", "group");
    orientation.setAttribute("aria-label", "Output orientation");
    const orientationButtons = ["Landscape", "Portrait"].map((label) => {
      const button = this.button(label, undefined, () => {
        const width = Number(widthField.value);
        const height = Number(heightField.value);
        const swap = label === "Landscape" ? width < height : width > height;
        if (swap) {
          widthField.value = String(height);
          heightField.value = String(width);
          widthField.dispatchEvent(new Event("input", { bubbles: true }));
          heightField.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
      button.insertAdjacentHTML(
        "afterbegin",
        '<svg class="selection-check" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
      );
      orientation.append(button);
      return button;
    });
    const syncTemplate = () => {
      const width = Number(widthField.value);
      const height = Number(heightField.value);
      orientationButtons[0]!.setAttribute(
        "aria-pressed",
        String(width > height),
      );
      orientationButtons[1]!.setAttribute(
        "aria-pressed",
        String(height > width),
      );

      const size = `${widthField.value}x${heightField.value}`;
      templateSelect.value = [...templateSelect.options].some(
        (option) => option.value === size,
      )
        ? size
        : "";
    };
    templateSelect.onchange = () => {
      if (!templateSelect.value) return;
      const [width, height] = templateSelect.value.split("x");
      widthField.value = width!;
      heightField.value = height!;
      // Notify UI listeners only; templates never start a render.
      widthField.dispatchEvent(new Event("input", { bubbles: true }));
      heightField.dispatchEvent(new Event("input", { bubbles: true }));
    };
    widthField.addEventListener("input", syncTemplate, {
      signal: this.controller.signal,
    });
    heightField.addEventListener("input", syncTemplate, {
      signal: this.controller.signal,
    });
    this.settingsViews.push(syncTemplate);
    syncTemplate();
    templateField.append(templateLabel, templateSelect);
    outputSection.append(heading, templateField, orientation, this.controls);
    const renderSection = doc.createElement("details");
    renderSection.className = "trs-accordion";
    renderSection.open = true;
    const renderHeading = doc.createElement("summary");
    renderHeading.textContent = "Rendering";
    const renderContent = doc.createElement("div");
    renderContent.className = "trs-accordion-content";
    renderContent.append(actions, this.bar, this.status);
    renderSection.append(renderHeading, renderContent);
    this.element.append(outputSection, renderSection);
    options.container.append(this.element);
    this.previewElement = doc.createElement("section");
    this.previewElement.className = "trs-preview trs-panel";
    this.previewElement.setAttribute("aria-label", "Render preview");
    const tools = doc.createElement("div");
    tools.className = "trs-preview-tools";
    tools.setAttribute("role", "group");
    tools.setAttribute("aria-label", "Preview zoom controls");
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
    this.canvas.hidden = true;
    this.canvas.setAttribute("aria-label", "Latest completed render frame");
    this.video = doc.createElement("video");
    this.video.controls = false;
    this.video.draggable = false;
    this.video.addEventListener(
      "loadedmetadata",
      () => {
        this.video.style.width = `${this.video.videoWidth}px`;
        this.video.style.height = `${this.video.videoHeight}px`;
        this.fit();
      },
      {
        signal: this.controller.signal,
      },
    );
    this.video.playsInline = true;
    this.video.className = "trs-image trs-result-video";
    this.video.hidden = true;
    this.video.setAttribute("aria-label", "Rendered animation");
    this.image = doc.createElement("img");
    this.image.className = "trs-image";
    this.image.draggable = false;
    this.image.alt = "Saved render";
    this.image.hidden = true;
    this.outputFrame = doc.createElement("div");
    this.outputFrame.className = "trs-image trs-output-frame";
    this.outputFrame.setAttribute("role", "img");
    this.sequenceTools = doc.createElement("div");
    this.sequenceTools.className = "trs-sequence-tools";
    this.sequenceTools.hidden = true;
    doc.addEventListener(
      "fullscreenchange",
      () => {
        this.syncFullscreenButton();
        if (doc.fullscreenElement === this.viewport) {
          this.fit();
          this.revealFullscreenControls();
        } else {
          this.clearFullscreenTimer();
          this.viewport.classList.remove("trs-player-idle");
          if (this.previewBeforeFullscreen) {
            Object.assign(this, this.previewBeforeFullscreen);
            this.previewBeforeFullscreen = undefined;
            this.transform();
          }
        }
      },
      { signal: this.controller.signal },
    );
    for (const event of ["pointerdown", "wheel", "keydown"])
      this.sequenceTools.addEventListener(
        event,
        (event) => event.stopPropagation(),
        { signal: this.controller.signal },
      );
    this.viewport.append(
      this.outputFrame,
      this.canvas,
      this.video,
      this.image,
      this.sequenceTools,
    );
    const syncOutputFrame = () => this.syncOutputFrame();
    for (const name of ["width", "height", "transparent"]) {
      this.fields.get(name)!.addEventListener("input", syncOutputFrame, {
        signal: this.controller.signal,
      });
      this.fields.get(name)!.addEventListener("change", syncOutputFrame, {
        signal: this.controller.signal,
      });
    }
    this.syncOutputFrame();
    const slotTools = doc.createElement("div");
    slotTools.className = "trs-slot-tools";
    this.channels = doc.createElement("select");
    this.channels.setAttribute("aria-label", "Render channel");
    this.channels.add(new Option("Channel 1", "1"));
    const newChannelOption = new Option("+ New channel", "new");
    this.channels.add(newChannelOption);
    this.channels.onchange = () => {
      if (this.channels.value === "new") {
        const id = String(this.channels.options.length);
        this.channels.add(new Option(`Channel ${id}`, id), newChannelOption);
        this.channels.value = id;
      }
      this.refreshResults();
    };
    const remove = this.button("Delete render", "delete", () => {
      if (this.options.session.busy || this.operation) return;
      const index = this.artifacts.findIndex(
        (artifact) => artifact.channel === this.channel,
      );
      if (index >= 0) {
        const [artifact] = this.artifacts.splice(index, 1);
        this.releaseArtifact(artifact);
      }
      this.video.pause();
      this.refreshResults();
    });
    this.deleteButton = remove;
    this.deleteButton.disabled = true;
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
    const channelField = doc.createElement("label");
    channelField.className = "trs-outlined-field";
    channelField.append(this.channels);
    slotTools.append(channelField, this.downloadButton, remove);
    const toolbars = doc.createElement("div");
    toolbars.className = "trs-floating-toolbars";
    toolbars.append(slotTools, tools);
    this.previewElement.append(toolbars, this.viewport);
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
    const reflect = () => {
      this.reflectingSettings = true;
      try {
        const value = this.settings.getSnapshot();
        for (const [key, field] of this.fields) {
          if (key === "samplingMode")
            field.value =
              value.sampleIntervalSeconds === undefined
                ? "Normal"
                : "Timelapse";
          else if (key === "sampleIntervalSeconds")
            field.value = String(value.sampleIntervalSeconds ?? 1);
          else if (
            field instanceof HTMLInputElement &&
            field.type === "checkbox"
          )
            field.checked = Boolean(value[key as keyof RecordingSettings]);
          else
            field.value = String(
              value[key as keyof RecordingSettings] ??
                (key === "cameraFit" ? "auto" : ""),
            );
        }
        for (const sync of this.settingsViews) sync();
        this.syncOutputFrame();
      } finally {
        this.reflectingSettings = false;
      }
    };
    const read = () => {
      if (!this.reflectingSettings)
        this.settings.updateSettings(this.readSettings());
    };
    this.controls.addEventListener("input", read, {
      signal: this.controller.signal,
    });
    this.controls.addEventListener("change", read, {
      signal: this.controller.signal,
    });
    this.cleanup.push(this.settings.subscribe(reflect));
    reflect();
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
  private setupToolbarTooltips() {
    this.cleanup.push(
      setupTooltips(
        this.element,
        ".trs-actions button",
        this.controller.signal,
      ),
    );
    this.cleanup.push(
      setupTooltips(
        this.previewElement,
        ".trs-slot-tools button, .trs-slot-tools select, .trs-preview-tools button, .trs-sequence-tools button",
        this.controller.signal,
      ),
    );
  }
  private field(key: string, label: string, value: string | number | boolean) {
    const doc = this.element.ownerDocument,
      wrapper = doc.createElement("label"),
      input = doc.createElement("input");
    const caption = doc.createElement("span");
    caption.textContent = label;
    wrapper.append(caption);
    wrapper.className = "trs-outlined-field";
    input.name = key;
    input.type =
      typeof value === "boolean"
        ? "checkbox"
        : typeof value === "number"
          ? "number"
          : "text";
    if (typeof value === "boolean") {
      wrapper.className = "trs-checkbox-field";
      input.checked = value;
    } else input.value = String(value);
    if (typeof value === "number") {
      input.min = ["width", "height", "fps"].includes(key) ? "1" : "0";
      input.step = key === "fps" ? "any" : "1";
    }
    if (input.type === "checkbox") wrapper.prepend(input);
    else wrapper.append(input);
    this.controls.append(wrapper);
    this.fields.set(key, input);
    return input;
  }
  private samplingSettings() {
    this.select(
      "samplingMode",
      "Sampling",
      ["Normal", "Timelapse"],
      this.options.job.sampleIntervalSeconds === undefined
        ? "Normal"
        : "Timelapse",
    );
    const interval = this.field(
      "sampleIntervalSeconds",
      "Capture interval (scene seconds)",
      this.options.job.sampleIntervalSeconds ?? 1,
    );
    interval.min = "0";
    interval.step = "any";
    interval.required = true;
    const speed = this.element.ownerDocument.createElement("output");
    speed.className = "trs-sampling-speed";
    speed.setAttribute("aria-live", "polite");
    this.controls.append(speed);
    const sync = () => {
      const timelapse = this.fields.get("samplingMode")!.value === "Timelapse";
      interval.parentElement!.hidden = !timelapse;
      speed.hidden = !timelapse;
      const multiplier =
        Number(interval.value) * Number(this.fields.get("fps")!.value);
      speed.textContent =
        Number.isFinite(multiplier) && multiplier > 0
          ? `${Number(multiplier.toPrecision(6))}× playback speed · scene time`
          : "Enter a positive capture interval";
    };
    this.controls.addEventListener("input", sync, {
      signal: this.controller.signal,
    });
    this.controls.addEventListener("change", sync, {
      signal: this.controller.signal,
    });
    this.settingsViews.push(sync);
    sync();
  }
  private frameRange(start: number, end: number) {
    const doc = this.element.ownerDocument;
    const first = this.field("startFrame", "First frame", start);
    const last = this.field("endFrame", "Last frame", end);
    const group = doc.createElement("fieldset");
    group.className = "trs-frame-range";
    group.setAttribute("aria-label", "Frame range");
    const track = doc.createElement("div");
    track.className = "trs-range-track";
    const sliders = [first, last].map((field, index) => {
      const slider = doc.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.step = "1";
      slider.setAttribute(
        "aria-label",
        index === 0 ? "First frame slider" : "Last frame slider",
      );
      track.append(slider);
      return slider;
    });
    let maximum = Math.max(1, end);
    const sync = () => {
      const low = Number(first.value),
        high = Number(last.value);
      maximum = Math.max(maximum, high);
      sliders.forEach((slider, index) => {
        slider.max = String(maximum);
        slider.value = index === 0 ? first.value : last.value;
        slider.setAttribute("aria-valuemin", index === 0 ? "0" : first.value);
        slider.setAttribute(
          "aria-valuemax",
          index === 0 ? last.value : String(maximum),
        );
      });
      track.style.setProperty("--range-start", `${(low / maximum) * 100}%`);
      track.style.setProperty("--range-end", `${(high / maximum) * 100}%`);
      // Keep coincident handles reachable at either edge.
      sliders[0].style.zIndex = low === maximum ? "3" : "1";
      first.max = last.value;
      last.min = first.value;
    };
    [first, last].forEach((field, index) => {
      const normalize = () => {
        if (field.value === "" || !Number.isFinite(field.valueAsNumber)) return;
        const value = Math.max(0, Math.round(field.valueAsNumber));
        field.value = String(
          index === 0
            ? Math.min(value, Number(last.value))
            : Math.max(value, Number(first.value)),
        );
        sync();
      };
      field.addEventListener("input", normalize, {
        signal: this.controller.signal,
      });
      field.addEventListener(
        "change",
        () => {
          if (!field.value) field.value = index === 0 ? "0" : first.value;
          normalize();
        },
        { signal: this.controller.signal },
      );
      sliders[index].addEventListener(
        "input",
        () => {
          field.value = sliders[index].value;
          field.dispatchEvent(new Event("input", { bubbles: true }));
        },
        { signal: this.controller.signal },
      );
    });
    const firstLabel = first.parentElement!;
    const lastLabel = last.parentElement!;
    group.append(track, firstLabel, lastLabel);
    this.controls.append(group);
    this.settingsViews.push(sync);
    sync();
  }
  private select(key: string, label: string, values: string[], value: string) {
    const doc = this.element.ownerDocument,
      wrapper = doc.createElement("label"),
      select = doc.createElement("select");
    const caption = doc.createElement("span");
    caption.textContent = label;
    wrapper.append(caption);
    wrapper.className = "trs-outlined-field";
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
  private readSettings(): RecordingSettings {
    const job = { ...this.settings.getSnapshot() };
    for (const [key, input] of this.fields) {
      if (key === "samplingMode" || key === "sampleIntervalSeconds") continue;
      (job as unknown as Record<string, unknown>)[key] =
        input instanceof HTMLInputElement && input.type === "checkbox"
          ? input.checked
          : ["width", "height", "fps", "startFrame", "endFrame"].includes(key)
            ? Number(input.value)
            : input.value;
    }
    if (this.fields.get("samplingMode")!.value === "Timelapse")
      job.sampleIntervalSeconds = Number(
        this.fields.get("sampleIntervalSeconds")!.value,
      );
    else job.sampleIntervalSeconds = undefined;
    job.fileName =
      (job.fileName ?? "render")
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .slice(0, 80) || "render";
    return job;
  }
  /** Snapshot settings without consulting DOM fields. */
  getJob(): RenderJob {
    return {
      ...this.settings.getSnapshot(),
      id: this.jobId,
      contentId: this.options.job.contentId,
    };
  }
  updateSettings(patch: Partial<RecordingSettings>) {
    this.settings.updateSettings(patch);
  }
  subscribeSettings(listener: () => void) {
    return this.settings.subscribe(listener);
  }
  async start() {
    if (this.options.session.busy || this.operation) return;
    this.jobId = crypto.randomUUID();
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
    this.deleteButton.disabled =
      busy || (this.canvas.hidden && this.image.hidden && this.video.hidden);
    this.channels.disabled = busy;
    this.stillButton.disabled = busy;
    for (const [name, field] of this.fields)
      field.disabled =
        busy || (name === "transparent" && !this.transparencySupported);
    for (const control of this.element.querySelectorAll<
      HTMLButtonElement | HTMLSelectElement
    >(
      ".trs-orientation button, .trs-template select, .trs-frame-range input[type=range]",
    ))
      control.disabled = busy;
    this.renderButton.disabled = busy;
    this.pauseButton.disabled = !busy || progress.state === "cancelling";
    this.cancelButton.disabled = !busy;
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
  addSequenceResult(sequence: PngSequence, channel = this.channel) {
    this.addResult(
      sequence.archive,
      `${sequence.job.fileName ?? sequence.job.id}.zip`,
      channel,
      sequence,
    );
  }
  private releaseArtifact(artifact: {
    url: string;
    sequence?: { urls: string[] };
  }) {
    URL.revokeObjectURL(artifact.url);
    artifact.sequence?.urls.forEach((url) => URL.revokeObjectURL(url));
  }
  private stopSequence() {
    if (this.playbackAnimationFrame !== undefined) {
      this.element.ownerDocument.defaultView!.cancelAnimationFrame(
        this.playbackAnimationFrame,
      );
      this.playbackAnimationFrame = undefined;
    }
    if (this.sequenceTimer !== undefined) {
      this.element.ownerDocument.defaultView!.clearInterval(this.sequenceTimer);
      this.sequenceTimer = undefined;
    }
    this.video.onended =
      this.video.onseeked =
      this.video.ontimeupdate =
      this.video.onplay =
      this.video.onpause =
      this.video.ondurationchange =
        null;
    this.sequenceTools.hidden = true;
    this.sequenceTools.replaceChildren();
  }
  addResult(
    blob: Blob,
    filename: string,
    channel = this.channel,
    sequence?: PngSequence,
  ) {
    if (this.controller.signal.aborted) return;
    const bytes =
      blob.size +
      (sequence?.frames.reduce((sum, frame) => sum + frame.blob.size, 0) ?? 0);
    const retained = this.artifacts
      .filter((artifact) => artifact.channel !== channel)
      .reduce((sum, artifact) => sum + artifact.bytes, 0);
    if (retained + bytes > (this.options.maxRetainedBytes ?? 256 * 1024 * 1024))
      throw new Error(
        "Channel memory limit reached. Delete a render or save to Folder or Receiver.",
      );
    const previous = this.artifacts.findIndex(
      (artifact) => artifact.channel === channel,
    );
    if (previous >= 0) {
      const [replaced] = this.artifacts.splice(previous, 1);
      this.releaseArtifact(replaced);
    }
    this.artifacts.push({
      bytes,
      sequence: sequence
        ? {
            urls: sequence.frames.map((frame) =>
              URL.createObjectURL(frame.blob),
            ),
            fps: sequence.job.fps,
          }
        : undefined,
      channel,
      filename,
      type: blob.type,
      url: URL.createObjectURL(blob),
    });
    if (channel === this.channel) this.refreshResults();
  }
  private clearFullscreenTimer() {
    if (this.fullscreenHideTimer !== undefined)
      this.element.ownerDocument.defaultView!.clearTimeout(
        this.fullscreenHideTimer,
      );
    this.fullscreenHideTimer = undefined;
  }
  private revealFullscreenControls() {
    this.clearFullscreenTimer();
    this.viewport.classList.remove("trs-player-idle");
    if (this.element.ownerDocument.fullscreenElement !== this.viewport) return;
    this.fullscreenHideTimer =
      this.element.ownerDocument.defaultView!.setTimeout(() => {
        const playing = !this.video.hidden
          ? !this.video.paused
          : this.sequenceTimer !== undefined;
        if (
          playing &&
          !this.sequenceTools.matches(":hover") &&
          !this.sequenceTools.querySelector(":focus-visible")
        )
          this.viewport.classList.add("trs-player-idle");
      }, 2500);
  }
  private fullscreenButton() {
    const button = this.button("Fullscreen output", "fullscreen", () => {
      const doc = this.element.ownerDocument;
      const action =
        doc.fullscreenElement === this.viewport
          ? doc.exitFullscreen()
          : this.viewport.requestFullscreen();
      void action.catch((error) => {
        this.status.textContent = String(error);
      });
    });
    button.dataset.outputFullscreen = "";
    button.disabled = !this.element.ownerDocument.fullscreenEnabled;
    return button;
  }
  private syncFullscreenButton() {
    const button = this.sequenceTools.querySelector<HTMLButtonElement>(
      "[data-output-fullscreen]",
    );
    if (!button) return;
    const active =
      this.element.ownerDocument.fullscreenElement === this.viewport;
    const label = active ? "Exit output fullscreen" : "Fullscreen output";
    const replacement = this.button(
      label,
      active ? "exitFullscreen" : "fullscreen",
      () => {},
    );
    button.replaceChildren(...replacement.childNodes);
    button.setAttribute("aria-label", label);
    button.removeAttribute("title");
  }
  private updatePlaybackButton(
    button: HTMLButtonElement,
    playing: boolean,
    kind: string,
  ) {
    const label = `${playing ? "Pause" : "Play"} ${kind}`;
    if (button.getAttribute("aria-label") === label) return;
    const replacement = this.button(
      label,
      playing ? "pause" : "resume",
      () => {},
    );
    button.replaceChildren(...replacement.childNodes);
    button.setAttribute("aria-label", label);
    button.removeAttribute("title");
    this.revealFullscreenControls();
    const tooltipId = button.getAttribute("aria-describedby");
    if (tooltipId) {
      const tooltip = button.ownerDocument.getElementById(tooltipId);
      if (tooltip) tooltip.textContent = label;
    }
  }
  private refreshResults() {
    this.displayResult();
  }
  private displayResult() {
    this.stopSequence();
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    const artifact = this.artifacts.find(
      (artifact) => artifact.channel === this.channel,
    );
    this.downloadButton.disabled = !artifact;
    this.canvas.hidden = true;
    this.outputFrame.hidden = !!artifact;
    this.syncOutputFrame();
    this.deleteButton.disabled =
      !artifact || this.options.session.busy || this.operation;
    this.video.hidden = !artifact?.type.startsWith("video/");
    this.image.hidden =
      !artifact?.sequence && !artifact?.type.startsWith("image/");
    this.updateZoom();
    if (!artifact) {
      this.canvas
        .getContext("2d")!
        .clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.image.removeAttribute("src");
      return;
    }
    if (artifact.sequence) {
      const { urls, fps } = artifact.sequence;
      const doc = this.element.ownerDocument;
      const play = this.button("Play sequence", "resume", () => {
        if (this.sequenceTimer !== undefined) {
          doc.defaultView!.clearInterval(this.sequenceTimer);
          this.sequenceTimer = undefined;
          this.updatePlaybackButton(play, false, "sequence");
        } else {
          this.updatePlaybackButton(play, true, "sequence");
          this.sequenceTimer = doc.defaultView!.setInterval(() => {
            scrub.value = String((Number(scrub.value) + 1) % urls.length);
            show();
          }, 1000 / fps);
        }
      });
      const scrub = doc.createElement("input");
      scrub.type = "range";
      scrub.min = "0";
      scrub.max = String(urls.length - 1);
      scrub.step = "1";
      scrub.value = "0";
      scrub.setAttribute("aria-label", "Sequence frame");
      const count = doc.createElement("output");
      const show = () => {
        this.image.src = urls[Number(scrub.value)];
        scrub.style.setProperty(
          "--trs-playback-progress",
          `${urls.length <= 1 ? 100 : (Number(scrub.value) / (urls.length - 1)) * 100}%`,
        );
        count.textContent = `${Number(scrub.value) + 1} / ${urls.length}`;
      };
      scrub.oninput = show;
      this.image.onload = () => {
        if (this.fitting) this.fit();
      };
      this.sequenceTools.append(play, scrub, count, this.fullscreenButton());
      this.syncFullscreenButton();
      this.sequenceTools.hidden = false;
      show();
    } else if (artifact.type.startsWith("video/")) {
      this.video.src = artifact.url;
      const play = this.button("Play video", "resume", () => {
        if (this.video.paused)
          void this.video.play().catch((error) => {
            this.status.textContent = String(error);
          });
        else this.video.pause();
      });
      const scrub = this.element.ownerDocument.createElement("input");
      scrub.type = "range";
      scrub.min = "0";
      scrub.max = "0";
      scrub.step = "any";
      scrub.value = "0";
      scrub.setAttribute("aria-label", "Video playback position");
      scrub.oninput = () => {
        this.video.currentTime = Number(scrub.value);
      };
      const time = this.element.ownerDocument.createElement("output");
      const sync = () => {
        const duration = Number.isFinite(this.video.duration)
          ? this.video.duration
          : 0;
        scrub.max = String(duration);
        const position = this.video.ended
          ? duration
          : Math.min(this.video.currentTime, duration);
        scrub.value = String(position);
        scrub.style.setProperty(
          "--trs-playback-progress",
          `${duration > 0 ? (position / duration) * 100 : 0}%`,
        );
        this.updatePlaybackButton(
          play,
          !this.video.paused && !this.video.ended,
          "video",
        );
        time.textContent = `${position.toFixed(1)} / ${duration.toFixed(1)}s`;
      };
      const win = this.element.ownerDocument.defaultView!;
      const tick = () => {
        this.playbackAnimationFrame = undefined;
        sync();
        if (!this.video.paused && !this.video.ended)
          this.playbackAnimationFrame = win.requestAnimationFrame(tick);
      };
      const refresh = () => {
        if (this.playbackAnimationFrame !== undefined)
          win.cancelAnimationFrame(this.playbackAnimationFrame);
        tick();
      };
      this.video.ontimeupdate =
        this.video.onseeked =
        this.video.ondurationchange =
          sync;
      this.video.onplay = this.video.onpause = this.video.onended = refresh;
      this.sequenceTools.append(play, scrub, time, this.fullscreenButton());
      this.syncFullscreenButton();
      this.sequenceTools.hidden = false;
      sync();
    } else {
      this.image.onload = () => this.fit();
      this.image.src = artifact.url;
    }
  }
  async renderImage() {
    if (this.options.session.busy || this.operation) return;
    this.jobId = crypto.randomUUID();
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
      this.addResult(
        blob,
        `${job.fileName ?? job.id}-frame-${frame}.png`,
        channel,
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
  showFrame(frame: CapturedFrame, index?: number) {
    this.stopSequence();
    this.video.pause();
    this.video.hidden = true;
    this.image.hidden = true;
    this.outputFrame.hidden = true;
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
  private syncOutputFrame() {
    const transparent = (this.fields.get("transparent") as HTMLInputElement)
      .checked;
    this.outputFrame.style.backgroundColor = transparent
      ? "transparent"
      : "var(--trs-surface)";

    const width = Number(this.fields.get("width")!.value);
    const height = Number(this.fields.get("height")!.value);
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    )
      return;
    this.outputFrame.style.width = `${width}px`;
    this.outputFrame.style.height = `${height}px`;
    this.outputFrame.setAttribute(
      "aria-label",
      `Output frame, ${width} by ${height}`,
    );
    if (!this.outputFrame.hidden) {
      if (this.fitting) this.fit();
      else this.transform();
    }
  }
  fit() {
    this.fitting = true;
    this.offset = { x: 0, y: 0 };
    const fullscreen =
      this.element.ownerDocument.fullscreenElement === this.viewport;
    this.scale = Math.max(
      0.001,
      Math.min(
        (this.viewport.clientWidth - (fullscreen ? 0 : 32)) /
          (!this.outputFrame.hidden
            ? parseFloat(this.outputFrame.style.width)
            : !this.video.hidden
              ? this.video.videoWidth || this.canvas.width
              : !this.image.hidden
                ? this.image.naturalWidth || this.canvas.width
                : this.canvas.width),
        (this.viewport.clientHeight -
          (fullscreen ? 0 : 32 + (this.sequenceTools.hidden ? 0 : 52))) /
          (!this.outputFrame.hidden
            ? parseFloat(this.outputFrame.style.height)
            : !this.video.hidden
              ? this.video.videoHeight || this.canvas.height
              : !this.image.hidden
                ? this.image.naturalHeight || this.canvas.height
                : this.canvas.height),
      ),
    );
    this.transform();
  }
  private updateZoom() {
    const scale = this.scale;
    const percent =
      scale *
      (this.element.ownerDocument.defaultView?.devicePixelRatio ?? 1) *
      100;
    this.zoomOutput.value = `${Number(percent.toFixed(1))}%`;
  }
  private transform() {
    this.updateZoom();
    this.video.style.transform =
      this.outputFrame.style.transform =
      this.image.style.transform =
      this.canvas.style.transform =
        `translate(calc(-50% + ${this.offset.x}px), calc(-50% + ${this.offset.y}px)) scale(${this.scale})`;
    const width = !this.video.hidden
      ? this.video.videoWidth
      : this.image.naturalWidth;
    const height = !this.video.hidden
      ? this.video.videoHeight
      : this.image.naturalHeight;
    this.sequenceTools.style.width = `${Math.max(200, width * this.scale)}px`;
    this.sequenceTools.style.left = `calc(50% + ${this.offset.x}px)`;
    this.sequenceTools.style.top = `calc(50% + ${this.offset.y + (height * this.scale) / 2 + 6}px)`;
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
    for (const event of ["pointermove", "pointerdown", "keydown", "focusin"])
      this.viewport.addEventListener(
        event,
        () => this.revealFullscreenControls(),
        { signal },
      );
    this.sequenceTools.addEventListener(
      "pointerleave",
      () => this.revealFullscreenControls(),
      { signal },
    );
    let hovering = false;
    this.viewport.addEventListener(
      "pointerenter",
      () => {
        hovering = true;
      },
      { signal },
    );
    this.viewport.addEventListener(
      "pointerleave",
      () => {
        hovering = false;
      },
      { signal },
    );
    this.element.ownerDocument.addEventListener(
      "keydown",
      (event) => {
        if (
          event.code !== "Space" ||
          !hovering ||
          this.sequenceTools.hidden ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return;
        const target = event.target as HTMLElement | null;
        if (
          target?.closest(
            "input, textarea, select, [contenteditable]:not([contenteditable=false])",
          )
        )
          return;
        const play =
          this.sequenceTools.querySelector<HTMLButtonElement>("button");
        if (!play || play.disabled) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) play.click();
      },
      { signal, capture: true },
    );
    this.viewport.addEventListener(
      "dragstart",
      (event) => event.preventDefault(),
      { signal },
    );
    let drag: { x: number; y: number } | undefined;
    this.viewport.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        if (this.element.ownerDocument.fullscreenElement === this.viewport)
          return;
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
        if (event.button !== 0 || !event.isPrimary) return;
        if (this.element.ownerDocument.fullscreenElement === this.viewport) {
          this.viewport.focus();
          this.sequenceTools
            .querySelector<HTMLButtonElement>("button")
            ?.click();
          return;
        }
        event.preventDefault();
        this.viewport.style.cursor = "grabbing";
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
          this.viewport.style.cursor = "";
        },
        { signal },
      );
    this.viewport.addEventListener(
      "keydown",
      (event) => {
        if (this.element.ownerDocument.fullscreenElement === this.viewport)
          return;
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
  /** Disable alpha for output formats that require opaque frames. */
  setTransparencySupported(supported: boolean) {
    const field = this.fields.get("transparent") as HTMLInputElement;
    if (supported !== this.transparencySupported) {
      if (!supported) {
        this.preferredTransparency = field.checked;
        field.checked = false;
      } else field.checked = this.preferredTransparency;
      this.transparencySupported = supported;
    }
    field.disabled = !supported || this.options.session.busy || this.operation;
    field.parentElement!.title = supported ? "" : "MP4 output is opaque";
    this.settings.updateSettings({ transparent: field.checked });
    this.syncOutputFrame();
  }
  setTheme(theme: RenderTheme) {
    for (const name of Object.keys(theme) as Array<keyof RenderTheme>)
      for (const element of [this.element, this.previewElement])
        element.style.setProperty(`--trs-${name}`, theme[name]!);
  }
  dispose() {
    this.clearFullscreenTimer();
    this.stopSequence();
    this.controller.abort();
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    for (const artifact of this.artifacts) this.releaseArtifact(artifact);
    this.artifacts = [];
    this.observer.disconnect();
    for (const cleanup of this.cleanup) cleanup();
    this.element.remove();
    this.previewElement.remove();
  }
}
