import { packWebGPURows } from "./readback.js";
import { RenderTarget, WebGPURenderer } from "three/webgpu";
import {
  Scene,
  Camera,
  UnsignedByteType,
  SRGBColorSpace,
  Color,
  Vector4,
} from "three";
import type {
  CaptureAdapter,
  FrameContext,
  RenderSettings,
} from "../core/types.js";
import { fitCamera } from "./camera.js";
export interface WebGPUCaptureOptions {
  renderer: WebGPURenderer;
  scene: Scene;
  camera: Camera | (() => Camera);
  /** Allocate stencil storage for scenes with stencil materials. */
  stencil?: boolean;
  samples?: 0 | 4;
  /** Render final output using the configured output target, including the renderer's output conversion. */
  render?: (
    renderer: WebGPURenderer,
    target: RenderTarget,
    camera: Camera,
    context: FrameContext,
  ) => void | Promise<void>;
}
export class WebGPUCaptureAdapter implements CaptureAdapter {
  private target?: RenderTarget;
  private settings?: RenderSettings;
  constructor(private readonly options: WebGPUCaptureOptions) {}
  async prepare(settings: RenderSettings) {
    this.finish();
    await this.options.renderer.init();
    const backend = this.options.renderer.backend as unknown as {
      isWebGPUBackend?: boolean;
      device?: { limits: { maxTextureDimension2D: number } };
    };
    if (!backend.isWebGPUBackend)
      throw new Error(
        "WebGPU capture requires native WebGPU; select WebGL mode for fallback",
      );
    const max = backend.device?.limits.maxTextureDimension2D ?? 8192;
    if (settings.width > max || settings.height > max)
      throw new Error(`Output exceeds WebGPU limit ${max}`);
    this.settings = { ...settings };
    this.target = new RenderTarget(settings.width, settings.height, {
      type: UnsignedByteType,
      stencilBuffer: this.options.stencil ?? false,
      samples: this.options.samples ?? 4,
    });
    this.target.texture.colorSpace = SRGBColorSpace;
  }
  async capture(context: FrameContext) {
    const { renderer, scene, camera } = this.options,
      target = this.target!,
      settings = this.settings!;
    if (!target) throw new Error("Capture not prepared");
    const old = {
      target: renderer.getRenderTarget(),
      output: renderer.getOutputRenderTarget(),
      space: renderer.outputColorSpace,
      color: renderer.getClearColor(new Color()),
      alpha: renderer.getClearAlpha(),
      viewport: renderer.getViewport(new Vector4()),
      scissor: renderer.getScissor(new Vector4()),
      scissorTest: renderer.getScissorTest(),
      autoClear: renderer.autoClear,
    };
    try {
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.autoClear = true;
      renderer.setClearAlpha(settings.transparent ? 0 : 1);
      renderer.setOutputRenderTarget(target);
      renderer.setRenderTarget(null);
      const exportCamera = fitCamera(
        typeof camera === "function" ? camera() : camera,
        settings.width,
        settings.height,
        settings.cameraFit,
      );
      if (this.options.render)
        await this.options.render(renderer, target, exportCamera, context);
      else renderer.render(scene, exportCamera);
      const pixels = await renderer.readRenderTargetPixelsAsync(
        target,
        0,
        0,
        settings.width,
        settings.height,
      );
      const bytes = packWebGPURows(
        new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
        settings.width,
        settings.height,
      );
      // Three's output conversion premultiplies in output color space.
      for (let i = 0; i < bytes.length; i += 4) {
        const alpha = bytes[i + 3];
        if (alpha === 255) continue;
        for (let c = 0; c < 3; c++)
          bytes[i + c] = alpha
            ? Math.min(255, Math.round((bytes[i + c] * 255) / alpha))
            : 0;
      }
      return { pixels: bytes, width: settings.width, height: settings.height };
    } finally {
      renderer.setOutputRenderTarget(old.output);
      renderer.setRenderTarget(old.target);
      renderer.outputColorSpace = old.space;
      renderer.autoClear = old.autoClear;
      renderer.setClearColor(old.color, old.alpha);
      renderer.setViewport(old.viewport);
      renderer.setScissor(old.scissor);
      renderer.setScissorTest(old.scissorTest);
    }
  }
  finish() {
    this.target?.dispose();
    this.target = undefined;
    this.settings = undefined;
  }
  dispose() {
    this.finish();
  }
}
