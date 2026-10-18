import { RenderComponent } from "./component.js";
import { setupTooltips } from "./tooltip.js";
import { putPixels } from "../destinations/pixels.js";
import { resolveResolution } from "../core/resolution.js";
import type { PngSequence } from "../destinations/memory.js";
import type { CapturedFrame } from "../core/types.js";
import type { RenderPanelOptions } from "./types.js";
import type { RenderController } from "../core/controller.js";
export interface RenderPreviewOptions extends Pick<
  RenderPanelOptions,
  "container" | "theme" | "icons" | "renderIcon" | "maxRetainedBytes"
> {
  controller: RenderController;
}
export class RenderPreview extends RenderComponent {
  readonly element: HTMLElement;
  readonly toolbar: HTMLElement;
  private readonly recording: RenderController;
  private canvas: HTMLCanvasElement;
  private outputFrame: HTMLDivElement;
  private viewport: HTMLElement;
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
  private lastFrame?: number;
  private video: HTMLVideoElement;
  private image: HTMLImageElement;
  private channels: HTMLSelectElement;
  private downloadButton: HTMLButtonElement;
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

  constructor(private readonly viewOptions: RenderPreviewOptions) {
    super(viewOptions);
    this.recording = viewOptions.controller;
    const options = { ...viewOptions, job: this.recording.getJob() };
    const doc = options.container.ownerDocument;
    this.element = doc.createElement("section");
    this.element.className = "trs-preview trs-panel";
    this.element.setAttribute("aria-label", "Render preview");
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
      if (this.recording.busy) return;
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
    this.element.append(toolbars, this.viewport);
    options.container.append(this.element);

    this.toolbar = tools;
    this.cleanup.push(
      setupTooltips(
        this.element,
        ".trs-slot-tools button, .trs-slot-tools select, .trs-preview-tools button, .trs-sequence-tools button",
        this.controller.signal,
      ),
    );
    this.setupNavigation();
    this.observer = new ResizeObserver(() => {
      if (this.fitting) this.fit();
      else this.updateZoom();
    });
    this.observer.observe(this.viewport);
    this.cleanup.push(
      this.recording.session.onFrame((frame, index) =>
        this.showFrame(frame, index),
      ),
      this.recording.settings.subscribe(() => this.syncOutputFrame()),
      this.recording.subscribe(() => this.update()),
      this.recording.onImage((result) =>
        this.addResult(result.blob, result.filename, result.channel),
      ),
    );
    this.setTheme(options.theme ?? {});
    this.channels.addEventListener(
      "change",
      () => {
        this.recording.channel = this.channel;
      },
      { signal: this.controller.signal },
    );
  }
  private update() {
    if (
      ["failed", "cancelled"].includes(this.recording.status.state) &&
      !this.recording.busy
    )
      this.displayResult();
    this.deleteButton.disabled =
      this.recording.busy ||
      (this.canvas.hidden && this.image.hidden && this.video.hidden);
    this.channels.disabled = this.recording.busy;
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
    if (
      retained + bytes >
      (this.viewOptions.maxRetainedBytes ?? 256 * 1024 * 1024)
    )
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
        this.recording.reportError(error);
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
    this.deleteButton.disabled = !artifact || this.recording.busy;
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
            this.recording.reportError(error);
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
    const settings = this.recording.settings.getSnapshot();
    const transparent = settings.transparent;
    this.outputFrame.style.backgroundColor = transparent
      ? "transparent"
      : "var(--trs-surface)";

    let width: number, height: number;
    try {
      ({ width, height } = resolveResolution(settings));
    } catch {
      return;
    }
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

  override dispose() {
    this.clearFullscreenTimer();
    this.stopSequence();
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    for (const artifact of this.artifacts) this.releaseArtifact(artifact);
    this.artifacts = [];
    this.observer.disconnect();
    super.dispose();
  }
}
