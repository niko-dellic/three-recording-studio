import { expect, it, vi } from "vitest";
import {
  DirectoryFileStorage,
  MemoryFileStorage,
} from "../src/destinations/storage.js";
import { createRecordingDestination } from "../src/destinations/composed.js";
vi.mock("../src/destinations/pixels.js", () => ({
  pngBlob: async () => new Blob(["png"], { type: "image/png" }),
}));
const signal = new AbortController().signal;
const job = {
  id: "job",
  contentId: "scene",
  width: 2,
  height: 2,
  fps: 30,
  startFrame: 0,
  endFrame: 0,
};

it("composes PNG encoding with bounded memory storage", async () => {
  const storage = new MemoryFileStorage({ maxBytes: 3 });
  const destination = await createRecordingDestination({
    format: "png",
    storage,
  });
  await destination.open(job, signal);
  await destination.write(
    { width: 2, height: 2, pixels: new Uint8Array(16) },
    { frame: 0, time: 0, delta: 1 / 30, signal },
  );
  await destination.close();
  expect(storage.getFiles()[0].filename).toBe("job-00000000.png");
  expect(await storage.getFiles()[0].blob.text()).toBe("png");
  await expect(
    storage.write({ filename: "overflow.png", blob: new Blob(["x"]) }, signal),
  ).rejects.toThrow("memory limit");
  expect(storage.getFiles()).toHaveLength(1);
  await destination.abort(new Error("discard"));
  expect(storage.getFiles()).toHaveLength(0);
});

it("directory storage awaits writes and aborts streaming resources", async () => {
  const events: string[] = [];
  const writer = {
    write: vi.fn(async () => {
      events.push("write");
    }),
    close: vi.fn(async () => {
      events.push("close");
    }),
    abort: vi.fn(async () => {
      events.push("abort");
    }),
  };
  const folder = {
    getFileHandle: vi.fn(async () => ({ createWritable: async () => writer })),
  };
  const directory = { getDirectoryHandle: vi.fn(async () => folder) };
  const storage = new DirectoryFileStorage(
    directory as unknown as FileSystemDirectoryHandle,
  );
  await storage.open(job, "mp4", signal);
  await storage.write(
    { filename: "clip.mp4", blob: new Blob(["mp4"]) },
    signal,
  );
  expect(events).toEqual(["write", "close"]);
  const stream = await storage.openStream("stream.mp4", signal);
  const sink = stream.getWriter();
  await sink.write({ type: "write", position: 0, data: new Uint8Array([1]) });
  await sink.abort("cancel");
  expect(events).toEqual(["write", "close", "write", "abort"]);
  await storage.abort("cancel");
  expect(writer.abort).toHaveBeenCalledTimes(1);
  await expect(
    storage.write({ filename: "../bad", blob: new Blob() }, signal),
  ).rejects.toThrow("Invalid output filename");
});

it("streaming is explicit and rejected for unsupported storage before opening", async () => {
  const storage = new MemoryFileStorage();
  const destination = await createRecordingDestination({
    format: "mp4",
    storage,
    streaming: true,
  });
  await expect(destination.check!(job, { signal })).rejects.toThrow(
    "stream-capable",
  );
  expect(storage.getFiles()).toEqual([]);
  await expect(
    createRecordingDestination({ format: "png", storage, streaming: true }),
  ).rejects.toThrow("not applicable");
});
