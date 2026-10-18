import { RenderComponent } from "./component.js";
import { RenderController } from "../core/controller.js";
import { RenderSettingsView } from "./settings.js";
import { RenderPreview } from "./preview.js";
import { RenderTransport } from "./transport.js";
import { RenderProgress } from "./progress.js";
import type { RenderPanelOptions, RenderTheme } from "./types.js";
import type { RecordingSettings } from "../core/settings.js";
import type { CapturedFrame } from "../core/types.js";
import type { PngSequence } from "../destinations/memory.js";
export * from "./types.js";
export * from "./settings.js";
export * from "./preview.js";
export * from "./transport.js";
export * from "./progress.js";
export { RenderController } from "../core/controller.js";
/** Default composition. Views never own or dispose the supplied render session. */
export class RenderPanel extends RenderComponent {
  readonly element: HTMLElement;
  readonly previewElement: HTMLElement;
  readonly recording: RenderController;
  readonly settingsView: RenderSettingsView;
  readonly previewView: RenderPreview;
  readonly transport: RenderTransport;
  readonly progress: RenderProgress;
  private mode: "embedded" | "floating";
  constructor(options: RenderPanelOptions) {
    super(options);
    this.recording = new RenderController(options);
    const doc = options.container.ownerDocument;
    this.element = doc.createElement("section");
    this.element.className = "trs-panel";
    this.mode = options.mode ?? "embedded";
    this.element.dataset.mode = this.mode;
    options.container.append(this.element);
    this.settingsView = new RenderSettingsView({
      ...options,
      container: this.element,
      controller: this.recording,
    });
    const heading =
      this.settingsView.element.querySelector<HTMLElement>("summary")!;
    const float = this.button("Float panel", "float", () => {
      this.mode = this.mode === "floating" ? "embedded" : "floating";
      this.element.dataset.mode = this.mode;
      float.setAttribute("aria-pressed", String(this.mode === "floating"));
    });
    if (options.allowFloating !== false) heading.append(float);
    this.setupDragging(heading);
    const renderSection = doc.createElement("details");
    renderSection.className = "trs-accordion";
    renderSection.open = true;
    const renderHeading = doc.createElement("summary");
    renderHeading.textContent = "Rendering";
    const content = doc.createElement("div");
    content.className = "trs-accordion-content";
    renderSection.append(renderHeading, content);
    this.element.append(renderSection);
    this.transport = new RenderTransport({
      ...options,
      container: content,
      controller: this.recording,
    });
    this.progress = new RenderProgress({
      ...options,
      container: content,
      controller: this.recording,
    });
    this.previewView = new RenderPreview({
      ...options,
      container: options.previewContainer ?? this.element,
      controller: this.recording,
    });
    this.previewElement = this.previewView.element;
    this.setTheme(options.theme ?? {});
  }
  get settings() {
    return this.recording.settings;
  }
  get channel() {
    return this.previewView.channel;
  }
  getJob() {
    return this.recording.getJob();
  }
  updateSettings(patch: Partial<RecordingSettings>) {
    this.settings.updateSettings(patch);
  }
  subscribeSettings(listener: () => void) {
    return this.settings.subscribe(listener);
  }
  async start() {
    await this.recording.start().catch(() => {});
  }
  async preview() {
    await this.recording.preview().catch(() => {});
  }
  async renderImage() {
    await this.recording.renderImage().catch(() => {});
  }
  addResult(
    blob: Blob,
    filename: string,
    channel = this.channel,
    sequence?: PngSequence,
  ) {
    this.previewView.addResult(blob, filename, channel, sequence);
  }
  addSequenceResult(sequence: PngSequence, channel = this.channel) {
    this.previewView.addSequenceResult(sequence, channel);
  }
  showFrame(frame: CapturedFrame, index?: number) {
    this.previewView.showFrame(frame, index);
  }
  fit() {
    this.previewView.fit();
  }
  setTransparencySupported(supported: boolean) {
    this.settingsView.setTransparencySupported(supported);
  }
  override setTheme(theme: RenderTheme) {
    super.setTheme(theme);
    for (const view of [
      this.settingsView,
      this.previewView,
      this.transport,
      this.progress,
    ])
      view.setTheme(theme);
  }
  override dispose() {
    this.settingsView.dispose();
    this.previewView.dispose();
    this.transport.dispose();
    this.progress.dispose();
    this.recording.dispose();
    super.dispose();
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
}
