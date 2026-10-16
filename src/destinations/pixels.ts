import type { CapturedFrame } from "../core/types.js";
export function putPixels(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  frame: CapturedFrame,
) {
  context.putImageData(
    new ImageData(
      new Uint8ClampedArray(frame.pixels),
      frame.width,
      frame.height,
    ),
    0,
    0,
  );
}
export async function pngBlob(frame: CapturedFrame): Promise<Blob> {
  const canvas = new OffscreenCanvas(frame.width, frame.height);
  putPixels(canvas.getContext("2d")!, frame);
  return canvas.convertToBlob({ type: "image/png" });
}
