import { describe, it, expect } from "vitest";
import { packWebGPURows } from "../src/capture/readback";
describe("WebGPU RGBA8 row packing", () => {
  for (const width of [720, 1080, 65, 1280]) {
    for (const fullPadding of [false, true]) {
      it(`packs width ${width}, full padding ${fullPadding}`, () => {
        const height = 7,
          row = width * 4,
          stride = Math.ceil(row / 256) * 256;
        const length = stride * (height - 1) + (fullPadding ? stride : row);
        const storage = new Uint8Array(length + 16).fill(239);
        const source = storage.subarray(8, 8 + length);
        const expected = new Uint8Array(row * height);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < row; x++) {
            source[y * stride + x] = expected[y * row + x] = (y * 31 + x) % 233;
          }
        }
        expect(packWebGPURows(source, width, height)).toEqual(expected);
      });
    }
  }
  it("rejects an unexpected buffer instead of silently corrupting pixels", () => {
    expect(() => packWebGPURows(new Uint8Array(15), 720, 1280)).toThrow(
      "Unexpected WebGPU readback size",
    );
  });
});
