/** Normalize RGBA8 WebGPU readback rows to the tightly packed frame contract. */
export function packWebGPURows(
  source: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const rowBytes = width * 4;
  const packedLength = rowBytes * height;
  if (source.byteLength === packedLength) return source;
  const stride = Math.ceil(rowBytes / 256) * 256;
  // Three r186 omits padding on the final row. Also accept fully padded buffers.
  if (
    source.byteLength !== stride * (height - 1) + rowBytes &&
    source.byteLength !== stride * height
  ) {
    throw new Error(
      `Unexpected WebGPU readback size: ${source.byteLength} bytes for ${width} × ${height} RGBA8`,
    );
  }
  const packed = new Uint8Array(packedLength);
  for (let y = 0; y < height; y++) {
    packed.set(
      source.subarray(y * stride, y * stride + rowBytes),
      y * rowBytes,
    );
  }
  return packed;
}
