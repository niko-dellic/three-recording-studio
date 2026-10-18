import { RenderComponent } from "./component.js";
import type { RenderPanelOptions } from "./types.js";
import type {
  RecordingSettings,
  RecordingSettingsStore,
} from "../core/settings.js";
import type { RenderController } from "../core/controller.js";
export interface RenderSettingsViewOptions extends Pick<
  RenderPanelOptions,
  "container" | "theme" | "icons" | "renderIcon" | "controls"
> {
  controller: RenderController;
}
export class RenderSettingsView extends RenderComponent {
  readonly element: HTMLElement;
  readonly settings: RecordingSettingsStore;
  readonly slots: { afterDimensions: HTMLElement; frameRange: HTMLElement };
  private controls: HTMLFormElement;
  private fields = new Map<string, HTMLInputElement | HTMLSelectElement>();
  private settingsViews: Array<() => void> = [];
  private reflectingSettings = false;
  private transparencySupported = true;
  private preferredTransparency = true;
  constructor(private readonly viewOptions: RenderSettingsViewOptions) {
    super(viewOptions);
    this.recording = viewOptions.controller;
    this.settings = this.recording.settings;
    const options = { ...viewOptions, job: this.recording.getJob() };
    const doc = options.container.ownerDocument;
    this.element = doc.createElement("section");
    this.element.className = "trs-panel trs-component";
    this.element.setAttribute("aria-label", "Render settings");
    const heading = doc.createElement("summary");
    heading.className = "trs-header";
    heading.textContent = "Render output";
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

    this.element.append(outputSection);
    options.container.append(this.element);
    this.controls.addEventListener(
      "submit",
      (event) => event.preventDefault(),
      { signal: this.controller.signal },
    );
    const afterDimensions = doc.createElement("div");
    afterDimensions.className = "trs-extension";
    dimensions.after(afterDimensions);
    const frameRange = doc.createElement("div");
    frameRange.className = "trs-extension";
    this.fields.get("endFrame")!.closest("fieldset")!.after(frameRange);
    if (options.controls?.cameraFit === false)
      this.fields.get("cameraFit")!.parentElement!.remove();
    if (options.controls?.frameRange === false)
      this.fields.get("endFrame")!.closest("fieldset")!.remove();
    this.slots = { afterDimensions, frameRange };
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

    this.cleanup.push(this.recording.subscribe(() => this.update()));
    this.setTheme(options.theme ?? {});
  }
  private readonly recording: RenderController;
  private update() {
    for (const [name, field] of this.fields)
      field.disabled =
        this.recording.busy ||
        (name === "transparent" && !this.transparencySupported);
    for (const control of this.element.querySelectorAll<
      HTMLInputElement | HTMLButtonElement | HTMLSelectElement
    >(
      ".trs-orientation button, .trs-template select, .trs-frame-range input[type=range]",
    ))
      control.disabled = this.recording.busy;
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
      this.recording.getJob().sampleIntervalSeconds === undefined
        ? "Normal"
        : "Timelapse",
    );
    const interval = this.field(
      "sampleIntervalSeconds",
      "Capture interval (scene seconds)",
      this.recording.getJob().sampleIntervalSeconds ?? 1,
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
  setTransparencySupported(supported: boolean) {
    const field = this.fields.get("transparent") as HTMLInputElement;
    if (supported !== this.transparencySupported) {
      if (!supported) {
        this.preferredTransparency = field.checked;
        field.checked = false;
      } else field.checked = this.preferredTransparency;
      this.transparencySupported = supported;
    }
    field.disabled = !supported || this.recording.busy;
    field.parentElement!.title = supported ? "" : "MP4 output is opaque";
    this.settings.updateSettings({ transparent: field.checked });
  }
}
