import { mkdtemp, writeFile, readFile, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const root = process.cwd(),
  temporary = await mkdtemp(join(tmpdir(), "trs-packed-"));
try {
  const output = execFileSync(
    "npm",
    ["pack", "--json", "--pack-destination", root],
    { cwd: root, encoding: "utf8" },
  );
  const files = JSON.parse(output);
  const archive = resolve(files[0].filename);
  await writeFile(
    join(temporary, "package.json"),
    JSON.stringify({
      name: "trs-clean-consumer",
      private: true,
      type: "module",
    }),
  );
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--omit=optional",
      "--cache",
      "/private/tmp/three-recording-studio-npm-cache",
      archive,
      "three@0.186.1",
    ],
    { cwd: temporary, stdio: "pipe" },
  );
  const result = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {RenderSession,WebGLCaptureAdapter,WebGPUCaptureAdapter,MemorySequenceDestination,DirectoryDestination,saveFileToDirectory,WebSocketDestination} from 'three-recording-studio';import {RenderPanel} from 'three-recording-studio/ui';console.log([RenderSession,WebGLCaptureAdapter,WebGPUCaptureAdapter,RenderPanel,MemorySequenceDestination,DirectoryDestination,saveFileToDirectory,WebSocketDestination].map(x=>typeof x).join(','));`,
    ],
    { cwd: temporary, encoding: "utf8" },
  );
  assert.equal(
    result.trim(),
    "function,function,function,function,function,function,function,function",
  );
  const lock = JSON.parse(
    await readFile(join(temporary, "package-lock.json"), "utf8"),
  );
  for (const name of [
    "quilt-core",
    "quilt-vanilla",
    "@theatre/core",
    "@theatre/studio",
    "react",
    "vitepress",
  ])
    assert(
      !lock.packages[`node_modules/${name}`],
      `Demo dependency leaked: ${name}`,
    );
  await readFile(
    join(temporary, "node_modules/three-recording-studio/dist/ui/style.css"),
  );
  const installed = join(temporary, "node_modules/three-recording-studio");
  const manifest = JSON.parse(
    await readFile(join(installed, "package.json"), "utf8"),
  );
  assert.equal(manifest.bin["three-recording-receiver"], "bin/receiver.mjs");
  for (const file of [
    "LICENSE",
    "CHANGELOG.md",
    "dist/index.d.ts",
    "dist/ui/index.d.ts",
    "dist/encoding/index.d.ts",
    "bin/receiver.mjs",
  ])
    await readFile(join(installed, file));
  const receiverResult = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import {createReceiver} from './node_modules/three-recording-studio/bin/receiver.mjs';const receiver=await createReceiver({directory:'recordings',port:0});await receiver.close();console.log('receiver ok');`,
    ],
    { cwd: temporary, encoding: "utf8" },
  );
  assert.equal(receiverResult.trim(), "receiver ok");
  const narrow = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import {WebGLCaptureAdapter} from 'three-recording-studio/capture/webgl';
    import {WebGPUCaptureAdapter} from 'three-recording-studio/capture/webgpu';
    import {fitCamera} from 'three-recording-studio/capture/camera';
    import {MemorySequenceDestination} from 'three-recording-studio/destinations';
    console.log([WebGLCaptureAdapter, WebGPUCaptureAdapter, fitCamera, MemorySequenceDestination].map(value => typeof value).join(','));
  `,
    ],
    { cwd: temporary, encoding: "utf8" },
  );
  assert.equal(narrow.trim(), "function,function,function,function");
  // A renderer-neutral consumer must work with Three.js physically absent.
  await rename(
    join(temporary, "node_modules/three"),
    join(temporary, "three-not-installed"),
  );
  const neutral = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import {RenderSession, RenderController, RenderResults, createRecordingSettings} from 'three-recording-studio/core';
    import {RenderPanel, RenderPreview} from 'three-recording-studio/ui';
    import {MemorySequenceDestination} from 'three-recording-studio/destinations';
    console.log([RenderSession, RenderController, RenderResults, createRecordingSettings, RenderPanel, RenderPreview, MemorySequenceDestination].map(value => typeof value).join(','));
  `,
    ],
    { cwd: temporary, encoding: "utf8" },
  );
  assert.equal(
    neutral.trim(),
    "function,function,function,function,function,function,function",
  );
  assert.equal(manifest.peerDependenciesMeta.three.optional, true);
  console.log(
    `Packed install passed without demo or optional encoding dependencies: ${archive}`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
