import type { CapturedFrame, RenderSettings } from "./types.js";

export class InvalidFrameError extends Error {
  readonly code = "INVALID_FRAME";
  constructor(message: string) {
    super(message);
    this.name = "InvalidFrameError";
  }
}
/** Enforce the packed, top-left, straight RGBA8 contract before any consumer sees it.
 * Color space/orientation are semantic adapter responsibilities, not inferred here.
 */
export function validateCapturedFrame(
  frame: CapturedFrame,
  expected?: Pick<RenderSettings, "width" | "height">,
): void {
  if (
    !frame ||
    !Number.isSafeInteger(frame.width) ||
    !Number.isSafeInteger(frame.height) ||
    frame.width < 1 ||
    frame.height < 1
  )
    throw new InvalidFrameError(
      "Captured frame dimensions must be positive safe integers",
    );
  if (
    expected &&
    (frame.width !== expected.width || frame.height !== expected.height)
  )
    throw new InvalidFrameError(
      `Captured ${frame.width} × ${frame.height}; expected ${expected.width} × ${expected.height}`,
    );
  const length = frame.width * frame.height * 4;
  // Cross-window Uint8Arrays are valid; instanceof alone rejects them.
  if (
    !ArrayBuffer.isView(frame.pixels) ||
    Object.prototype.toString.call(frame.pixels) !== "[object Uint8Array]" ||
    !Number.isSafeInteger(length) ||
    frame.pixels.byteLength !== length
  )
    throw new InvalidFrameError(
      `Expected ${length} tightly packed RGBA8 bytes for ${frame.width} × ${frame.height}; received ${frame.pixels?.byteLength ?? "no pixel buffer"}`,
    );
}
