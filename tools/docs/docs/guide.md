# Get started

Three Recording Studio adds an export workflow to an existing Three.js scene. It does not create an animation system or replace your renderer. Your application supplies explicit control over scene time.

The initial release supports Three.js 0.186.x, WebGLRenderer and native WebGPURenderer. The package is ESM with TypeScript declarations. The UI is optional. React, Quilt and Theatre are not required by the library.

```sh
npm install three-recording-studio three
```

Until publication, install the archive produced by `npm pack` instead of the registry name.

```ts
import { RenderSession, WebGLCaptureAdapter } from "three-recording-studio";
import { Mp4Destination } from "three-recording-studio/encoding";

const session = new RenderSession({
  capture: new WebGLCaptureAdapter({ renderer, scene, camera }),
  animation: {
    acquire() {
      const snapshot = { time: mixer.time, playing };
      exporting = true;
      playing = false;
      return snapshot;
    },
    seek({ time }) {
      mixer.setTime(time);
    },
    async ready() {
      await assetsReady;
    },
    restore(snapshot) {
      const saved = snapshot as { time: number; playing: boolean };
      mixer.setTime(saved.time);
      playing = saved.playing;
      exporting = false;
      previousTimestamp = performance.now();
    },
  },
});

await session.start(
  {
    id: "product-turntable",
    contentId: "scene-and-assets-v1",
    width: 3840,
    height: 1280,
    fps: 30,
    startFrame: 0,
    endFrame: 179,
    cameraFit: "auto",
  },
  new Mp4Destination({
    onComplete(blob) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "turntable.mp4";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    },
  }),
);
```

The variables in this example belong to your application's existing animation loop. That loop must skip both animation mutation and live rendering while `exporting` is true. Rebase elapsed wall-clock time after restoration so the next live frame does not jump ahead by the export duration.

Both ends of the frame range are inclusive: frames 0–179 at 30 fps make six seconds. Animation time remains absolute (`frame / fps`); video timestamps begin at zero for the selected range.

## Run the repository

Use Node 24 or newer:

```sh
npm ci
npm run build
npm run dev
```

The demo runs on `http://127.0.0.1:5190/demo`. Start the receiver in another terminal with `npm run receiver`. Paste its token into the demo's PNG sequence settings. The introduction is at `http://127.0.0.1:5190/`.
