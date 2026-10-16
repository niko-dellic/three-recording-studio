import { it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error companion is intentionally standalone Node ESM
import { createReceiver } from "../bin/receiver.mjs";
// @ts-expect-error ws runtime is shared with the companion
import WebSocket from "ws";
const job = {
  id: "resume-test",
  contentId: "scene-v1",
  width: 1,
  height: 1,
  fps: 30,
  startFrame: 0,
  endFrame: 1,
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6sB8AAAAASUVORK5CYII=",
  "base64",
);
async function connect(port: number, origin = "http://localhost:5187") {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}
function send(socket: any, data: unknown) {
  return new Promise<any>((resolve, reject) => {
    socket.once("message", (bytes: Buffer) =>
      resolve(JSON.parse(bytes.toString())),
    );
    socket.once("error", reject);
    socket.send(Buffer.isBuffer(data) ? data : JSON.stringify(data));
  });
}
function packet(frame: number) {
  const header = Buffer.alloc(4);
  header.writeUInt32LE(frame);
  return Buffer.concat([header, png]);
}
it("persists acknowledged frames, recovers after disconnect, checks identity and repairs corrupted files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trs-"));
  const receiver = await createReceiver({
    directory,
    port: 0,
    token: "secret",
  });
  try {
    let socket = await connect(receiver.port);
    expect(await send(socket, { type: "open", token: "secret", job })).toEqual({
      type: "opened",
      saved: [],
    });
    expect(await send(socket, packet(0))).toEqual({ type: "saved", frame: 0 });
    const manifest = JSON.parse(
      await readFile(join(directory, job.id, "manifest.json"), "utf8"),
    );
    expect(manifest.frames["0"].sha256).toHaveLength(64);
    await new Promise<void>((resolve) => {
      socket.once("close", resolve);
      socket.close();
    });
    socket = await connect(receiver.port);
    expect(await send(socket, { type: "open", token: "secret", job })).toEqual({
      type: "opened",
      saved: [0],
    });
    expect(await send(socket, packet(1))).toEqual({ type: "saved", frame: 1 });
    expect(await send(socket, { type: "finish" })).toEqual({
      type: "finished",
    });
    await new Promise<void>((resolve) => {
      socket.once("close", resolve);
      socket.close();
    });
    await writeFile(join(directory, job.id, "frame-00000000.png"), "corrupted");
    socket = await connect(receiver.port);
    expect(await send(socket, { type: "open", token: "secret", job })).toEqual({
      type: "opened",
      saved: [1],
    });
    await new Promise<void>((resolve) => {
      socket.once("close", resolve);
      socket.close();
    });
    socket = await connect(receiver.port);
    expect(
      (
        await send(socket, {
          type: "open",
          token: "secret",
          job: { ...job, contentId: "changed" },
        })
      ).error,
    ).toContain("identity changed");
  } finally {
    await receiver.close();
    await rm(directory, { recursive: true, force: true });
  }
});
it("rejects untrusted origins and unauthenticated writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trs-"));
  const receiver = await createReceiver({
    directory,
    port: 0,
    token: "secret",
  });
  try {
    await expect(
      connect(receiver.port, "https://untrusted.example"),
    ).rejects.toThrow();
    const socket = await connect(receiver.port);
    expect((await send(socket, packet(0))).error).toContain("Authenticate");
  } finally {
    await receiver.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("preserves scene sampling in the manifest and rejects mismatched resume intervals", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trs-interval-"));
  const receiver = await createReceiver({
    directory,
    port: 0,
    token: "secret",
  });
  try {
    let socket = await connect(receiver.port);
    const sampled = { ...job, sampleIntervalSeconds: 2 };
    expect(
      await send(socket, { type: "open", token: "secret", job: sampled }),
    ).toMatchObject({ type: "opened" });
    const manifest = JSON.parse(
      await readFile(join(directory, job.id, "manifest.json"), "utf8"),
    );
    expect(manifest.job.sampleIntervalSeconds).toBe(2);
    await new Promise<void>((resolve) => {
      socket.once("close", resolve);
      socket.close();
    });
    socket = await connect(receiver.port);
    expect(
      (
        await send(socket, {
          type: "open",
          token: "secret",
          job: { ...sampled, sampleIntervalSeconds: 3 },
        })
      ).error,
    ).toContain("identity changed");
  } finally {
    await receiver.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it("accepts authenticated bounded MP4 files and acknowledges persistence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trs-mp4-"));
  const receiver = await createReceiver({
    directory,
    port: 0,
    token: "secret",
  });
  try {
    const socket = await connect(receiver.port);
    expect(
      await send(socket, { type: "open", token: "secret", job }),
    ).toMatchObject({ type: "opened" });
    const file = Buffer.from([
      0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0,
    ]);
    expect(
      await send(socket, { type: "file", size: file.length }),
    ).toMatchObject({ type: "file-ready" });
    expect(await send(socket, file)).toMatchObject({ type: "file-saved" });
    expect(await send(socket, { type: "finish" })).toMatchObject({
      type: "finished",
    });
    expect(await readFile(join(directory, job.id, job.id + ".mp4"))).toEqual(
      file,
    );
    const manifest = JSON.parse(
      await readFile(join(directory, job.id, "manifest.json"), "utf8"),
    );
    expect(manifest.complete).toBe(true);
    expect(manifest.file.size).toBe(file.length);
  } finally {
    await receiver.close();
    await rm(directory, { recursive: true, force: true });
  }
});
it("rejects oversized MP4 uploads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "trs-mp4-limit-"));
  const receiver = await createReceiver({
    directory,
    port: 0,
    token: "secret",
  });
  try {
    const socket = await connect(receiver.port);
    await send(socket, { type: "open", token: "secret", job });
    expect(
      (await send(socket, { type: "file", size: 256 * 1024 * 1024 + 1 })).error,
    ).toContain("Invalid MP4 size");
  } finally {
    await receiver.close();
    await rm(directory, { recursive: true, force: true });
  }
});
