import { it, expect, vi } from "vitest";
vi.mock("../src/destinations/pixels.js", () => ({
  pngBlob: async () => new Blob(["hello"], { type: "image/png" }),
}));
import {
  MemorySequenceDestination,
  zipFrames,
} from "../src/destinations/memory";
const job = {
  id: "test",
  fileName: "clip",
  contentId: "test",
  width: 1,
  height: 1,
  fps: 30,
  startFrame: 0,
  endFrame: 0,
};
const signal = new AbortController().signal;
it("writes a valid stored ZIP entry and directory with PNG bytes", async () => {
  const zip = await zipFrames(
    [{ blob: new Blob(["hello"]), filename: "clip.png", frame: 0 }],
    signal,
  );
  const bytes = new Uint8Array(await zip.arrayBuffer()),
    view = new DataView(bytes.buffer);
  expect(view.getUint32(0, true)).toBe(0x04034b50);
  expect(view.getUint32(14, true)).toBe(0x3610a686);
  expect(new TextDecoder().decode(bytes.slice(30, 38))).toBe("clip.png");
  expect(new TextDecoder().decode(bytes.slice(38, 43))).toBe("hello");
  expect(view.getUint32(43, true)).toBe(0x02014b50);
  expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
  expect(view.getUint16(bytes.length - 12, true)).toBe(1);
});
it("enforces memory limits before publishing and releases on abort", async () => {
  const complete = vi.fn();
  const destination = new MemorySequenceDestination({
    maxBytes: 1,
    onComplete: complete,
  });
  await destination.open(job, signal);
  await expect(
    destination.write(
      { pixels: new Uint8Array(4), width: 1, height: 1 },
      { frame: 0, time: 0, delta: 1 / 30, signal },
    ),
  ).rejects.toThrow("memory limit");
  await destination.abort();
  expect(complete).not.toHaveBeenCalled();
});
it("publishes bounded frames and archive and honors cancellation", async () => {
  const complete = vi.fn(),
    destination = new MemorySequenceDestination({ onComplete: complete });
  await destination.open(job, signal);
  await destination.write(
    { pixels: new Uint8Array(4), width: 1, height: 1 },
    { frame: 0, time: 0, delta: 1 / 30, signal },
  );
  await destination.close();
  expect(complete.mock.calls[0][0].frames[0].filename).toBe(
    "clip-00000000.png",
  );
  const controller = new AbortController();
  controller.abort();
  await expect(zipFrames([], controller.signal)).rejects.toThrow();
});
