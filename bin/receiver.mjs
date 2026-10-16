#!/usr/bin/env node
import { WebSocketServer } from "ws";
import {
  mkdir,
  open,
  readFile,
  rename,
  lstat,
  realpath,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
async function atomic(path, bytes) {
  const temporary = `${path}.${randomBytes(5).toString("hex")}.tmp`;
  const file = await open(temporary, "wx");
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, path);
  const directory = await open(resolve(path, ".."), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
function normalize(job) {
  if (
    job?.fileName !== undefined &&
    !/^[a-zA-Z0-9_-]{1,80}$/.test(job.fileName)
  )
    throw Error("Invalid file name");
  if (
    !job ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(job.id) ||
    typeof job.contentId !== "string" ||
    !job.contentId.trim()
  )
    throw Error("Invalid job identity");
  for (const k of ["width", "height", "startFrame", "endFrame"])
    if (
      !Number.isSafeInteger(job[k]) ||
      job[k] < (k === "width" || k === "height" ? 1 : 0)
    )
      throw Error(`Invalid ${k}`);
  if (
    job.width > 16384 ||
    job.height > 16384 ||
    job.width * job.height > 67108864
  )
    throw Error("Receiver image limit exceeded");
  if (
    job.endFrame < job.startFrame ||
    job.endFrame > 0xffffffff ||
    !Number.isFinite(job.fps) ||
    job.fps <= 0 ||
    job.fps > 240
  )
    throw Error("Invalid frame range or FPS");
  if (
    job.cameraFit &&
    !["auto", "horizontal", "vertical"].includes(job.cameraFit)
  )
    throw Error("Invalid camera fit");
  return {
    id: job.id,
    ...(job.fileName === undefined ? {} : { fileName: job.fileName }),
    contentId: job.contentId,
    width: job.width,
    height: job.height,
    fps: job.fps,
    startFrame: job.startFrame,
    endFrame: job.endFrame,
    cameraFit: job.cameraFit ?? "auto",
    transparent: job.transparent ?? false,
  };
}
export async function createReceiver({
  directory = "recordings",
  port = 8787,
  token = randomBytes(24).toString("hex"),
  origins = [5187, 5190, 5191].flatMap((port) => [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ]),
} = {}) {
  await mkdir(directory, { recursive: true });
  const root = await realpath(directory);
  const locks = new Set();
  const server = new WebSocketServer({
    host: "127.0.0.1",
    port,
    maxPayload: 256 * 1024 * 1024,
    verifyClient: ({ origin }) => origins.includes(origin),
  });
  server.on("connection", (socket) => {
    let manifest, folder, jobId;
    let chain = Promise.resolve();
    let closing = false;
    const timeout = setTimeout(
      () => socket.close(1008, "Authentication timeout"),
      10000,
    );
    const send = (data) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(data));
    };
    socket.on("message", (data, binary) => {
      chain = chain
        .then(async () => {
          if (closing) return;
          if (binary) {
            if (!manifest) throw Error("Authenticate first");
            const bytes = Buffer.from(data);
            if (bytes.length < 28) throw Error("Invalid PNG frame");
            const frame = bytes.readUInt32LE(0),
              png = bytes.subarray(4),
              job = manifest.job;
            if (frame < job.startFrame || frame > job.endFrame)
              throw Error("Frame outside job range");
            if (
              !png.subarray(0, 8).equals(pngSignature) ||
              png.toString("ascii", 12, 16) !== "IHDR" ||
              png.readUInt32BE(16) !== job.width ||
              png.readUInt32BE(20) !== job.height
            )
              throw Error("PNG dimensions do not match job");
            const filename = `${job.fileName ?? "frame"}-${String(frame).padStart(8, "0")}.png`;
            const existing = await lstat(join(folder, filename)).catch(
              () => null,
            );
            if (existing?.isSymbolicLink())
              throw Error("Symlink output refused");
            await atomic(join(folder, filename), png);
            manifest.frames[frame] = { file: filename, sha256: digest(png) };
            manifest.complete = false;
            await atomic(
              join(folder, "manifest.json"),
              JSON.stringify(manifest, null, 2),
            );
            send({ type: "saved", frame });
            return;
          }
          const message = JSON.parse(data.toString());
          if (message.type === "open") {
            if (manifest) throw Error("Job already open");
            const given = Buffer.from(String(message.token ?? "")),
              expected = Buffer.from(token);
            if (
              given.length !== expected.length ||
              !timingSafeEqual(given, expected)
            )
              throw Error("Invalid receiver token");
            const job = normalize(message.job);
            if (locks.has(job.id)) throw Error("Job is already being written");
            locks.add(job.id);
            jobId = job.id;
            folder = join(root, job.id);
            await mkdir(folder, { recursive: true });
            if ((await lstat(folder)).isSymbolicLink())
              throw Error("Symlink directory refused");
            const manifestPath = join(folder, "manifest.json");
            if ((await lstat(manifestPath).catch(() => null))?.isSymbolicLink())
              throw Error("Symlink manifest refused");
            try {
              manifest = JSON.parse(await readFile(manifestPath, "utf8"));
            } catch (error) {
              if (error.code !== "ENOENT") throw error;
              manifest = { version: 1, job, frames: {}, complete: false };
            }
            if (
              manifest.version !== 1 ||
              JSON.stringify(manifest.job) !== JSON.stringify(job)
            )
              throw Error(
                "Job settings or content identity changed; choose a new job ID",
              );
            const saved = [];
            for (const [index, entry] of Object.entries(manifest.frames)) {
              const frame = Number(index),
                filename = `${job.fileName ?? "frame"}-${String(frame).padStart(8, "0")}.png`;
              if (
                !Number.isInteger(frame) ||
                frame < job.startFrame ||
                frame > job.endFrame ||
                entry.file !== filename
              )
                throw Error("Invalid saved-frame manifest");
              const path = join(folder, filename);
              if ((await lstat(path).catch(() => null))?.isSymbolicLink())
                throw Error("Symlink frame refused");
              const bytes = await readFile(path).catch(() => null);
              if (bytes && digest(bytes) === entry.sha256) saved.push(frame);
              else delete manifest.frames[index];
            }
            manifest.complete =
              saved.length === job.endFrame - job.startFrame + 1;
            await atomic(manifestPath, JSON.stringify(manifest, null, 2));
            clearTimeout(timeout);
            send({ type: "opened", saved });
          } else if (message.type === "finish" && manifest) {
            const count = manifest.job.endFrame - manifest.job.startFrame + 1;
            if (Object.keys(manifest.frames).length !== count)
              throw Error("Job has missing frames");
            manifest.complete = true;
            await atomic(
              join(folder, "manifest.json"),
              JSON.stringify(manifest, null, 2),
            );
            send({ type: "finished" });
          } else throw Error("Unknown receiver message");
        })
        .catch((error) => {
          send({ error: error.message });
          closing = true;
          socket.close(1008, "Request rejected");
        });
    });
    socket.on("close", () => {
      clearTimeout(timeout);
      void chain.finally(() => {
        if (jobId) locks.delete(jobId);
      });
    });
    socket.on("error", () => {});
  });
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return {
    server,
    token,
    port: server.address().port,
    close: async () => {
      for (const socket of server.clients) socket.terminate();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const args = process.argv.slice(2),
    value = (flag, fallback) => {
      const i = args.indexOf(flag);
      return i < 0 ? fallback : args[i + 1];
    };
  const receiver = await createReceiver({
    directory: value("--directory", "recordings"),
    port: Number(value("--port", "8787")),
    token: value("--token", undefined),
    origins: value(
      "--origins",
      [5187, 5190, 5191]
        .flatMap((port) => [
          `http://127.0.0.1:${port}`,
          `http://localhost:${port}`,
        ])
        .join(","),
    ).split(","),
  });
  console.log(
    `Three Recording Studio receiver\nURL: ws://127.0.0.1:${receiver.port}\nToken: ${receiver.token}\nOutput: ${resolve(value("--directory", "recordings"))}`,
  );
  process.on("SIGINT", async () => {
    await receiver.close();
    process.exit(0);
  });
}
