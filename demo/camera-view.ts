import { setupTooltips } from "../src/ui/tooltip";
import { Camera, Scene, PerspectiveCamera, OrthographicCamera } from "three";

/** Accept scene cameras and application-owned cameras (including Quilt view cameras). */
export class CameraViewSettings {
  readonly element = document.createElement("div");
  readonly viewportToolbar = document.createElement("div");
  readonly overlay = document.createElement("div");
  private select: HTMLSelectElement;
  private cameras: Camera[] = [];
  constructor(
    private scene: Scene,
    private supplied: Iterable<Camera>,
    private onSelect: (camera: Camera) => void,
  ) {
    this.element.className = "destination camera-settings";
    this.element.innerHTML = `<label class="studio-outlined-field"><span>Render camera</span><select aria-label="Render camera"></select></label>
      <div class="camera-overlay-toggles" role="group" aria-label="Camera overlays">
        <button type="button" data-frame aria-pressed="true"><svg class="selection-check" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Render frame</button>
        <button type="button" data-safe aria-pressed="true"><svg class="selection-check" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>Safe areas (90% / 80%)</button>
      </div>
      <label class="studio-outlined-field"><span>Composition guides</span><select data-guides aria-label="Composition guides"><option value="none">None</option><option value="thirds">Rule of thirds</option><option value="center">Center</option><option value="diagonals">Diagonals</option><option value="golden">Golden ratio</option></select></label>
      <label>Outside frame tint<input data-tint aria-label="Outside frame tint" type="range" min="0" max="1" step="0.05" value="0.7"></label>`;
    this.element
      .querySelectorAll<HTMLButtonElement>(".camera-overlay-toggles button")
      .forEach((button) => {
        button.addEventListener("click", () => {
          button.setAttribute(
            "aria-pressed",
            String(button.getAttribute("aria-pressed") !== "true"),
          );
        });
      });
    this.viewportToolbar.className = "viewport-toolbar";
    this.viewportToolbar.innerHTML = `<label class="studio-outlined-field"><select id="backend" aria-label="Renderer"><option value="webgl">WebGL</option><option value="webgpu">WebGPU</option></select></label>`;
    setupTooltips(this.viewportToolbar, "select");
    for (const event of ["pointerdown", "wheel", "keydown"]) {
      this.viewportToolbar.addEventListener(event, (e) => e.stopPropagation());
    }
    this.select = this.element.querySelector("select")!;
    this.select.onchange = () => {
      const camera = this.cameras.find((c) => c.uuid === this.select.value);
      if (camera) this.onSelect(camera);
    };
    this.overlay.className = "camera-overlay";
    this.overlay.innerHTML = `<div class="camera-frame"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><g class="composition"></g><g class="safe-areas"><rect x="5" y="5" width="90" height="90"/><rect x="10" y="10" width="80" height="80"/></g></svg></div>`;
    this.refresh();
  }
  private input<T extends HTMLElement>(key: string) {
    return this.element.querySelector<T>(`[data-${key}]`)!;
  }
  setDisabled(disabled: boolean) {
    this.element
      .querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLButtonElement
      >("input,select,button")
      .forEach((input) => (input.disabled = disabled));
  }
  refresh() {
    const cameras = new Set<Camera>(this.supplied);
    this.scene.traverse((object) => {
      if (
        object instanceof PerspectiveCamera ||
        object instanceof OrthographicCamera
      )
        cameras.add(object);
    });
    const next = [...cameras].filter(
      (c) => c instanceof PerspectiveCamera || c instanceof OrthographicCamera,
    );
    const previous = this.select.value;
    if (
      next.length === this.cameras.length &&
      next.every(
        (c, i) =>
          c === this.cameras[i] &&
          (c.name || `Camera ${i + 1}`) === this.select.options[i]?.text,
      )
    )
      return;
    this.cameras = next;
    this.select.replaceChildren(
      ...next.map((c, i) => new Option(c.name || `Camera ${i + 1}`, c.uuid)),
    );
    if (next.some((c) => c.uuid === previous)) this.select.value = previous;
    else if (next[0]) this.onSelect(next[0]);
  }
  update(
    fitted: Camera,
    width: number,
    height: number,
    aspect: number,
  ): Camera {
    this.overlay.hidden = false;
    const frameWidth = Math.min(width * 0.9, height * 0.9 * aspect);
    const frameHeight = frameWidth / aspect;
    const frame = this.overlay.firstElementChild as HTMLElement;
    Object.assign(frame.style, {
      width: `${frameWidth}px`,
      height: `${frameHeight}px`,
      borderColor:
        this.input<HTMLButtonElement>("frame").getAttribute("aria-pressed") ===
        "true"
          ? "#fff9"
          : "transparent",
      boxShadow: `0 0 0 10000px rgb(0 0 0 / ${this.input<HTMLInputElement>("tint").value})`,
    });
    const guides = this.input<HTMLSelectElement>("guides").value;
    const lines =
      guides === "thirds"
        ? [100 / 3, 200 / 3]
        : guides === "golden"
          ? [38.2, 61.8]
          : guides === "center"
            ? [50]
            : [];
    const markup =
      guides === "diagonals"
        ? '<path d="M0 0L100 100M100 0L0 100"/>'
        : lines.map((n) => `<path d="M${n} 0V100M0 ${n}H100"/>`).join("");
    const composition = frame.querySelector(".composition")!;
    if (composition.innerHTML !== markup) composition.innerHTML = markup;
    (frame.querySelector(".safe-areas") as SVGElement).style.display =
      this.input<HTMLButtonElement>("safe").getAttribute("aria-pressed") ===
      "true"
        ? ""
        : "none";
    // Expand the fitted projection to include space outside the render frame.
    // Scaling the entire clip-space X/Y rows also preserves off-axis projections.
    const view = fitted.clone();
    for (const i of [0, 4, 8, 12])
      view.projectionMatrix.elements[i] *= frameWidth / Math.max(width, 1);
    for (const i of [1, 5, 9, 13])
      view.projectionMatrix.elements[i] *= frameHeight / Math.max(height, 1);
    view.projectionMatrixInverse.copy(view.projectionMatrix).invert();
    return view;
  }
}
