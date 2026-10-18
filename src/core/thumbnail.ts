import type { CapturedFrame } from "./types.js";
import { validateCapturedFrame } from "./frames.js";
import { putPixels } from "../destinations/pixels.js";

/** Generate a small PNG while the captured frame's borrowed pixels remain valid. */
export async function createFrameThumbnail(
  frame: CapturedFrame,
  maxSize = 320,
): Promise<Blob> {
  if (!Number.isSafeInteger(maxSize) || maxSize < 1)
    throw new Error("Invalid thumbnail size");
  validateCapturedFrame(frame, frame);
  const source = new OffscreenCanvas(frame.width, frame.height);
  putPixels(source.getContext("2d")!, frame);
  const scale = Math.min(1, maxSize / Math.max(frame.width, frame.height));
  const thumbnail = new OffscreenCanvas(
    Math.max(1, Math.round(frame.width * scale)),
    Math.max(1, Math.round(frame.height * scale)),
  );
  thumbnail
    .getContext("2d")!
    .drawImage(source, 0, 0, thumbnail.width, thumbnail.height);
  return thumbnail.convertToBlob({ type: "image/png" });
}
