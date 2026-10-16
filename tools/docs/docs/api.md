# API reference

## Core entry point

Import from `three-recording-studio`.

| Export                 | Purpose                                             |
| ---------------------- | --------------------------------------------------- |
| `RenderSession`        | Owns the exclusive render-job lifecycle             |
| `WebGLCaptureAdapter`  | Captures WebGLRenderer scene output                 |
| `WebGPUCaptureAdapter` | Captures native WebGPURenderer output               |
| `WebSocketDestination` | Writes PNGs through the companion protocol          |
| `fitCamera`            | Creates an export camera with independent framing   |
| `validateJob`          | Validates dimensions, frame range, identity and FPS |

### RenderSession

Constructor: `{ animation: AnimationAdapter, capture: CaptureAdapter }`.

| Member                                       | Contract                                                                    |
| -------------------------------------------- | --------------------------------------------------------------------------- |
| `start(job, destination): Promise<void>`     | Resolves after completion or cancellation and restoration; rejects failures |
| `preview(job, frame?): Promise<CapturedFrame | undefined>`                                                                 | Captures one still through the exclusive lifecycle; returns copied pixels, or undefined if cancelled |
| `pause(): void`                              | Requests a pause after the in-flight frame is saved                         |
| `resume(): void`                             | Continues a paused job                                                      |
| `cancel(): void`                             | Aborts pending work cooperatively                                           |
| `dispose(): Promise<void>`                   | Cancels, waits, disposes adapter and listeners                              |
| `status`                                     | Read-only snapshot of state, counts, frame, elapsed time, ETA and error     |
| `busy`                                       | Whether a job is in flight, including cleanup                               |
| `subscribe(callback)`                        | Immediately emits status; returns an unsubscribe function                   |
| `onFrame(callback)`                          | Emits borrowed image data and frame index; returns unsubscribe              |

States: `idle`, `preparing`, `rendering`, `paused`, `cancelling`, `completed`, `cancelled`, `failed`, `disposed`.

### RenderJob

Required: `id`, `contentId`, `width`, `height`, `fps`, `startFrame`, `endFrame`. Optional: `cameraFit` (default `auto`), `transparent` (default false). Dimensions and frames are integers; FPS may be fractional, greater than zero and at most 240. Frame ranges are inclusive. IDs use letters, digits, underscores and hyphens, up to 80 characters.

### AnimationAdapter

`acquire()` returns a snapshot; `seek({frame,time,delta,signal})` evaluates scene state; optional `ready(context)` awaits application readiness; `restore(snapshot)` restores application state. Each operation may return a Promise.

### CaptureAdapter

`prepare(settings)`, `capture(context)`, `finish()`, `dispose()`. Capture resolves to `{pixels: Uint8Array, width, height}`. Pixel data is sRGB, top-left-origin RGBA8. `finish()` releases per-job resources; `dispose()` additionally releases adapter resources. Neither built-in adapter owns the supplied renderer or scene.

### RenderDestination

`open(job, signal): Promise<ReadonlySet<number>>`, `write(frame, context): Promise<void>`, `close(): Promise<void>`, `abort(reason): Promise<void>`.

## Encoding entry point

`Mp4Destination` from `three-recording-studio/encoding` accepts `{onComplete(blob), maxBytes?}`. Mediabunny is an optional dependency: installations omitting optional dependencies can use PNG export, but must install Mediabunny to import this entry point.

## UI entry point

`RenderPanel` from `three-recording-studio/ui` accepts `{container, session, job, destination, previewContainer?, mode?, allowFloating?, currentFrame?, imageDestination?, theme?, icons?}`. `destination(job)` may be asynchronous. Public methods: `getJob()`, `start()`, `preview()`, `renderImage()`, `addResult(blob, filename, channel?)`, `showFrame(frame,index?)`, `fit()`, `setTheme(theme)`, and `dispose()`. `channel` returns the selected result channel. `element` and `previewElement` expose the view roots.

All public interfaces are shipped as TypeScript declarations. Theme and adapter option types are exported alongside their classes.

`imageDestination(job)` optionally supplies a destination for **Render image**, in addition to retaining the resulting PNG in the gallery. `DirectoryDestination(directoryHandle)` saves numbered PNGs in a new subdirectory of the supplied writable directory.

## Select a render camera

Both capture adapters accept a camera or a callback that returns a camera:

```ts
let selectedCamera = cameras.get("main");
const capture = new WebGLCaptureAdapter({
  renderer,
  scene,
  camera: () => selectedCamera,
});
```

Use the same camera instances that your Quilt Three views use. Cameras can be
children of the scene or stored in an application map. The callback runs for each
captured frame. Keep the selection fixed during an export; camera animation can
continue through the animation adapter. Perspective and orthographic cameras are
supported. Capture fits a copy and does not change the source projection.

The demo provides a render-camera selector, camera and orbit views, a render-frame
border, 90% and 80% safe areas, composition guides, and an outside-frame tint
(passepartout). The frame uses the output dimensions and camera-fit setting.
Use **Viewport** to select the recording camera or the secondary camera. Drag to
orbit, use the wheel to zoom, and use right-drag to pan. The recording camera has
an orbit track in Theatre. Scrubbing or playback applies its keyframes; navigation
while paused remains in place until time changes. Quilt Three camera helpers show
the recording camera from the secondary view. Guides, tint, and the camera helper are
viewport aids and are not included in exported images or videos.
