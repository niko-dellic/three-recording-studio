import {
  Scene,
  Camera,
  WebGLRenderer,
  WebGLRenderTarget,
  HalfFloatType,
  UnsignedByteType,
  SRGBColorSpace,
  Vector4,
  Color,
} from "three";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type {
  CaptureAdapter,
  FrameContext,
  RenderSettings,
} from "../core/types.js";
import { fitCamera } from "./camera.js";
export interface WebGLCaptureOptions {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: Camera | (() => Camera);
  /** Allocate stencil storage for scenes with stencil materials. */
  stencil?: boolean;
  samples?: number;
  /** Produce linear scene-color into target; omit a final OutputPass. Restore any custom state you change. */
  render?: (
    renderer: WebGLRenderer,
    target: WebGLRenderTarget,
    camera: Camera,
    context: FrameContext,
  ) => void | Promise<void>;
}
export class WebGLCaptureAdapter implements CaptureAdapter {
  private linear?: WebGLRenderTarget;
  private output?: WebGLRenderTarget;
  private settings?: RenderSettings;
  private pixels = new Uint8Array();
  private flipped = new Uint8Array();
  private pass = new OutputPass();
  constructor(private readonly options: WebGLCaptureOptions) {
    // The composited linear target is premultiplied; PNG/ImageData need straight alpha.
    this.pass.material.fragmentShader =
      this.pass.material.fragmentShader.replace(
        "gl_FragColor = texture2D( tDiffuse, vUv );",
        "gl_FragColor = texture2D( tDiffuse, vUv ); gl_FragColor.rgb = gl_FragColor.a > 0.0 ? gl_FragColor.rgb / gl_FragColor.a : vec3(0.0);",
      );
  }
  prepare(settings: RenderSettings) {
    this.finish();
    const { renderer } = this.options;
    if (renderer.getContext().isContextLost())
      throw new Error("WebGL context is lost");
    if (!renderer.extensions.has("EXT_color_buffer_float"))
      throw new Error("Floating-point render targets are unavailable");
    const max = Math.min(
      renderer.capabilities.maxTextureSize,
      renderer
        .getContext()
        .getParameter(renderer.getContext().MAX_RENDERBUFFER_SIZE),
    );
    if (settings.width > max || settings.height > max)
      throw new Error(`Output exceeds WebGL limit ${max}`);
    this.settings = { ...settings };
    this.linear = new WebGLRenderTarget(settings.width, settings.height, {
      type: HalfFloatType,
      stencilBuffer: this.options.stencil ?? false,
      samples: Math.min(
        this.options.samples ?? 4,
        renderer.capabilities.maxSamples,
      ),
    });
    this.output = new WebGLRenderTarget(settings.width, settings.height, {
      type: UnsignedByteType,
      depthBuffer: false,
    });
    this.pixels = new Uint8Array(settings.width * settings.height * 4);
    this.flipped = new Uint8Array(this.pixels.length);
  }
  async capture(context: FrameContext) {
    const { renderer, scene, camera } = this.options,
      settings = this.settings!,
      target = this.linear!,
      output = this.output!;
    if (!target) throw new Error("Capture not prepared");
    if (renderer.getContext().isContextLost())
      throw new Error("WebGL context is lost");
    const old = {
      target: renderer.getRenderTarget(),
      face: renderer.getActiveCubeFace(),
      mip: renderer.getActiveMipmapLevel(),
      viewport: renderer.getViewport(new Vector4()),
      scissor: renderer.getScissor(new Vector4()),
      scissorTest: renderer.getScissorTest(),
      color: renderer.getClearColor(new Color()),
      alpha: renderer.getClearAlpha(),
      space: renderer.outputColorSpace,
      autoClear: renderer.autoClear,
      xr: renderer.xr.enabled,
    };
    try {
      renderer.xr.enabled = false;
      renderer.autoClear = true;
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.setScissorTest(false);
      renderer.setClearAlpha(settings.transparent ? 0 : 1);
      renderer.setRenderTarget(target);
      renderer.clear();
      const exportCamera = fitCamera(
        typeof camera === "function" ? camera() : camera,
        settings.width,
        settings.height,
        settings.cameraFit,
      );
      if (this.options.render)
        await this.options.render(renderer, target, exportCamera, context);
      else renderer.render(scene, exportCamera);
      this.pass.render(renderer, output, target, context.delta, false);
      await renderer.readRenderTargetPixelsAsync(
        output,
        0,
        0,
        settings.width,
        settings.height,
        this.pixels,
      );
      if (renderer.getContext().isContextLost())
        throw new Error("WebGL context was lost during capture");
      const stride = settings.width * 4;
      for (let y = 0; y < settings.height; y++)
        this.flipped.set(
          this.pixels.subarray(y * stride, (y + 1) * stride),
          (settings.height - 1 - y) * stride,
        );
      return {
        pixels: this.flipped,
        width: settings.width,
        height: settings.height,
      };
    } finally {
      renderer.setRenderTarget(old.target, old.face, old.mip);
      renderer.setViewport(old.viewport);
      renderer.setScissor(old.scissor);
      renderer.setScissorTest(old.scissorTest);
      renderer.setClearColor(old.color, old.alpha);
      renderer.outputColorSpace = old.space;
      renderer.autoClear = old.autoClear;
      renderer.xr.enabled = old.xr;
    }
  }
  finish() {
    this.linear?.dispose();
    this.output?.dispose();
    this.linear = undefined;
    this.output = undefined;
    this.settings = undefined;
    this.pixels = new Uint8Array();
    this.flipped = new Uint8Array();
  }
  dispose() {
    this.finish();
    this.pass.dispose();
  }
}
