import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import {
  WebGLCaptureAdapter,
  WebGPUCaptureAdapter,
  RenderSession,
} from "three-recording-studio";
import { Mp4Destination } from "three-recording-studio/encoding";
import { Input, BlobSource, ALL_FORMATS, VideoSampleSink } from "mediabunny";
export async function verifyCapture(
  backend: "webgl" | "webgpu",
  transparent = false,
  opacity = 1,
) {
  const scene = new THREE.Scene();
  scene.background = transparent ? null : new THREE.Color("#000000");
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 2;
  const red = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 1),
    new THREE.MeshBasicMaterial({
      color: "#ff0000",
      transparent: opacity < 1,
      opacity,
    }),
  );
  red.position.y = 0.5;
  scene.add(red);
  if (!transparent) {
    const blue = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 1),
      new THREE.MeshBasicMaterial({ color: "#0000ff" }),
    );
    blue.position.y = -0.5;
    scene.add(blue);
  }
  const renderer =
    backend === "webgpu"
      ? new WebGPURenderer({ alpha: true })
      : new THREE.WebGLRenderer({ alpha: true });
  if (backend === "webgpu") await (renderer as WebGPURenderer).init();
  renderer.setSize(100, 75);
  renderer.setViewport(3, 4, 80, 60);
  renderer.setScissor(4, 5, 70, 50);
  renderer.setScissorTest(true);
  const before = {
    viewport: renderer.getViewport(new THREE.Vector4()).toArray(),
    scissor: renderer.getScissor(new THREE.Vector4()).toArray(),
    size: renderer.getSize(new THREE.Vector2()).toArray(),
    alpha: renderer.getClearAlpha(),
  };
  const capture =
    backend === "webgpu"
      ? new WebGPUCaptureAdapter({
          renderer: renderer as WebGPURenderer,
          scene,
          camera,
        })
      : new WebGLCaptureAdapter({
          renderer: renderer as THREE.WebGLRenderer,
          scene,
          camera,
        });
  try {
    await capture.prepare({
      width: 128,
      height: 128,
      fps: 30,
      startFrame: 0,
      endFrame: 0,
      transparent,
      cameraFit: "vertical",
    });
    const frame = await capture.capture({
      frame: 0,
      time: 0,
      delta: 1 / 30,
      signal: new AbortController().signal,
    });
    const pixel = (x: number, y: number) =>
      Array.from(frame.pixels.slice((y * 128 + x) * 4, (y * 128 + x) * 4 + 4));
    const after = {
      viewport: renderer.getViewport(new THREE.Vector4()).toArray(),
      scissor: renderer.getScissor(new THREE.Vector4()).toArray(),
      size: renderer.getSize(new THREE.Vector2()).toArray(),
      alpha: renderer.getClearAlpha(),
    };
    return {
      top: pixel(64, 20),
      bottom: pixel(64, 108),
      before,
      after,
      scissorTest: renderer.getScissorTest(),
      gpu:
        backend === "webgpu"
          ? (renderer as any).backend.device.adapterInfo
          : null,
    };
  } finally {
    await capture.dispose();
    renderer.dispose();
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
export async function verifyMp4() {
  let blob: Blob | undefined;
  const pixels = new Uint8Array(64 * 64 * 4);
  let restored = false;
  const session = new RenderSession({
    animation: {
      acquire() {
        return null;
      },
      seek({ frame }) {
        for (let i = 0; i < pixels.length; i += 4) {
          pixels[i] = frame * 20;
          pixels[i + 1] = 0;
          pixels[i + 2] = 0;
          pixels[i + 3] = 255;
        }
      },
      restore() {
        restored = true;
      },
    },
    capture: {
      prepare() {},
      async capture() {
        return { pixels, width: 64, height: 64 };
      },
      finish() {},
      dispose() {},
    },
  });
  await session.start(
    {
      id: "mp4-test",
      contentId: "test",
      width: 64,
      height: 64,
      fps: 10,
      startFrame: 0,
      endFrame: 9,
    },
    new Mp4Destination({
      onComplete(value) {
        blob = value;
      },
    }),
  );
  const input = new Input({
    source: new BlobSource(blob!),
    formats: ALL_FORMATS,
  });
  try {
    const video = (await input.getPrimaryVideoTrack())!;
    const sink = new VideoSampleSink(video);
    let count = 0;
    const times: number[] = [];
    for await (const sample of sink.samples()) {
      count++;
      times.push(sample.timestamp);
      sample.close();
    }
    return {
      size: blob!.size,
      duration: await input.computeDuration(),
      width: video.displayWidth,
      height: video.displayHeight,
      count,
      times,
      restored,
    };
  } finally {
    input.dispose();
    await session.dispose();
  }
}

export { Vector2 } from "three";
export { WebSocketDestination } from "three-recording-studio";
export async function verifyMp4Limit() {
  let restored = false;
  const session = new RenderSession({
    animation: {
      acquire() {
        return null;
      },
      seek() {},
      restore() {
        restored = true;
      },
    },
    capture: {
      prepare() {},
      async capture() {
        const pixels = new Uint8Array(64 * 64 * 4).fill(255);
        return { pixels, width: 64, height: 64 };
      },
      finish() {},
      dispose() {},
    },
  });
  try {
    await session.start(
      {
        id: "limit-test",
        contentId: "test",
        width: 64,
        height: 64,
        fps: 10,
        startFrame: 0,
        endFrame: 2,
      },
      new Mp4Destination({
        maxBytes: 1,
        onComplete() {
          throw new Error("Unexpected completion");
        },
      }),
    );
    return { error: "", restored };
  } catch (error) {
    return { error: String(error), restored };
  } finally {
    await session.dispose();
  }
}
export async function inspectVideo(blob: Blob) {
  const input = new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });
  try {
    const track = (await input.getPrimaryVideoTrack())!;
    let count = 0;
    for await (const frame of new VideoSampleSink(track).samples()) {
      count++;
      frame.close();
    }
    return {
      width: track.displayWidth,
      height: track.displayHeight,
      count,
      duration: await input.computeDuration(),
    };
  } finally {
    input.dispose();
  }
}

export async function verifyComposedOutput(
  streaming: boolean,
  failure?: "cancel" | "write",
) {
  const { createRecordingDestination, MemoryFileStorage } =
    await import("three-recording-studio/destinations");
  const pixels = new Uint8Array(64 * 64 * 4);
  let restored = false,
    streamClosed = 0,
    streamAborted = 0,
    storageAborted = 0,
    writes = 0,
    position = 0;
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const session = new RenderSession({
    animation: {
      acquire() {},
      seek({ frame }) {
        for (let i = 0; i < pixels.length; i += 4) {
          pixels[i] = frame * 20;
          pixels[i + 3] = 255;
        }
      },
      restore() {
        restored = true;
      },
    },
    capture: {
      prepare() {},
      async capture() {
        return { pixels, width: 64, height: 64 };
      },
      finish() {},
      dispose() {},
    },
  });
  const memory = new MemoryFileStorage();
  const storage = streaming
    ? {
        async open() {
          return new Set<number>();
        },
        async write() {
          throw new Error("Streaming must not buffer a completed file");
        },
        async openStream() {
          return new WritableStream<
            import("three-recording-studio/destinations").FileChunk
          >({
            async write(chunk) {
              writes++;
              if (failure === "write") throw new Error("Disk disconnected");
              if (chunk.position !== position)
                throw new Error("Nonsequential fragmented MP4");
              await new Promise((resolve) => setTimeout(resolve, 3));
              chunks.push(chunk.data.slice());
              position += chunk.data.byteLength;
              if (failure === "cancel") session.cancel();
            },
            close() {
              streamClosed++;
            },
            abort() {
              streamAborted++;
            },
          });
        },
        async close() {},
        async abort() {
          storageAborted++;
        },
      }
    : memory;
  let error = "";
  try {
    await session.start(
      {
        id: "composed",
        contentId: "test",
        width: 64,
        height: 64,
        fps: 10,
        startFrame: 0,
        endFrame: 9,
      },
      await createRecordingDestination({ format: "mp4", storage, streaming }),
    );
  } catch (reason) {
    error = String(reason);
  }
  const state = session.status.state;
  await session.dispose();
  if (failure)
    return {
      state,
      error,
      restored,
      streamClosed,
      streamAborted,
      storageAborted,
      writes,
    };
  const blob = streaming
    ? new Blob(chunks, { type: "video/mp4" })
    : memory.getFiles()[0].blob;
  const input = new Input({
    source: new BlobSource(blob),
    formats: ALL_FORMATS,
  });
  try {
    const video = (await input.getPrimaryVideoTrack())!;
    const times: number[] = [];
    for await (const sample of new VideoSampleSink(video).samples()) {
      times.push(sample.timestamp);
      sample.close();
    }
    return {
      state,
      error,
      restored,
      streamClosed,
      streamAborted,
      storageAborted,
      writes,
      width: video.displayWidth,
      height: video.displayHeight,
      times,
    };
  } finally {
    input.dispose();
  }
}

export async function verifyAdapterContracts(backend: "webgl" | "webgpu") {
  const { runAdapterContract } = await import("three-recording-studio/testing");
  return runAdapterContract({
    job: {
      id: `contract-${backend}`,
      contentId: "contract",
      width: 64,
      height: 32,
      fps: 10,
      startFrame: 0,
      endFrame: 2,
    },
    scenarios: [
      "complete",
      "hidden-view",
      "cancel",
      "prepare-failure",
      "ready-failure",
      "write-failure",
    ],
    createFixture() {
      const renderer =
        backend === "webgpu" ? new WebGPURenderer() : new THREE.WebGLRenderer();
      renderer.setSize(32, 16);
      renderer.toneMapping = THREE.NoToneMapping;
      const host = document.createElement("div");
      host.append(renderer.domElement);
      document.body.append(host);
      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-2, 2, 1, -1, 0.1, 10);
      camera.position.z = 2;
      const material = new THREE.MeshBasicMaterial({ color: "blue" });
      const geometry = new THREE.PlaneGeometry(4, 2);
      scene.add(new THREE.Mesh(geometry, material));
      let time = 42,
        acquired = false;
      const capture =
        backend === "webgpu"
          ? new WebGPUCaptureAdapter({
              renderer: renderer as WebGPURenderer,
              scene,
              camera,
            })
          : new WebGLCaptureAdapter({
              renderer: renderer as THREE.WebGLRenderer,
              scene,
              camera,
            });
      return {
        capture,
        animation: {
          acquire() {
            acquired = true;
            return time;
          },
          seek(context) {
            time = context.time;
            material.color.set(context.frame % 2 ? "lime" : "red");
          },
          restore(snapshot) {
            time = snapshot as number;
            acquired = false;
            material.color.set("blue");
          },
        },
        assertFrame(frame, context) {
          if (!acquired || time !== context.frame / 10)
            throw new Error("Animation clock not evaluated");
          const offset = (16 * 64 + 32) * 4;
          const expected =
            context.frame % 2 ? [0, 255, 0, 255] : [255, 0, 0, 255];
          if (
            expected.some(
              (value, index) =>
                Math.abs(frame.pixels[offset + index] - value) > 2,
            )
          )
            throw new Error("Unexpected captured color or alpha");
        },
        assertRestored() {
          const size = renderer.getSize(new THREE.Vector2());
          if (
            acquired ||
            time !== 42 ||
            size.x !== 32 ||
            size.y !== 16 ||
            renderer.getRenderTarget() !== null ||
            camera.left !== -2
          )
            throw new Error("Application or renderer state was not restored");
        },
        detachView() {
          host.remove();
        },
        dispose() {
          renderer.dispose();
          material.dispose();
          geometry.dispose();
          host.remove();
        },
      };
    },
  });
}
