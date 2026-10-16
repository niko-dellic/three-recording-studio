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
