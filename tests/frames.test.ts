import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { validateCapturedFrame } from "../src/core/frames";
it.each([0, -1, NaN, 1.5, Infinity])(
  "rejects invalid frame dimensions %s",
  (width) => {
    expect(() =>
      validateCapturedFrame({ width, height: 2, pixels: new Uint8Array(16) }),
    ).toThrow("dimensions");
  },
);
it("rejects padding and wrong dimensions before downstream ImageData construction", () => {
  expect(() =>
    validateCapturedFrame({ width: 3, height: 2, pixels: new Uint8Array(512) }),
  ).toThrow("24 tightly packed");
  expect(() =>
    validateCapturedFrame(
      { width: 2, height: 3, pixels: new Uint8Array(24) },
      { width: 3, height: 2 },
    ),
  ).toThrow("expected 3 × 2");
});
it("accepts a packed subarray or cross-realm byte buffer", () => {
  validateCapturedFrame({
    width: 2,
    height: 2,
    pixels: new Uint8Array(32).subarray(8, 24),
  });
  validateCapturedFrame({
    width: 2,
    height: 2,
    pixels: runInNewContext("new Uint8Array(16)"),
  });
});
