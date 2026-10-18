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

### Scene-time sampling

Set optional `sampleIntervalSeconds` to a positive, finite number to advance scene time independently of output playback FPS. Omit it for normal sampling (`1 / fps`). Frame indices remain output frame indices, including when resuming or previewing: `time = frame * sampleIntervalSeconds`, and `delta` is the interval. Capture does not wait for real-world time to pass.

```ts
const timelapseJob = {
  ...job,
  fps: 30,
  sampleIntervalSeconds: 2,
  startFrame: 0,
  endFrame: 299,
};
```

This produces 300 frames (10 seconds of video) sampling scene times 0 through 598 seconds, at 60× playback speed. The sidebar's Sampling setting exposes Normal and Timelapse modes; Timelapse shows the scene-second interval and calculated speed. Switching back to Normal removes the explicit interval.

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

## Output destinations and retained results

- `MemorySequenceDestination({onComplete, maxBytes?})`: retains encoded PNGs, then calls `onComplete(sequence)` with `{frames, archive, job}`. Each frame contains `{blob, filename, frame}`; `archive` is a ZIP Blob. The default encoded-output ceiling is 128 MiB including ZIP headers, with at most 65,535 frames. Exceeding the limit fails the export and releases its buffers.
- `DirectoryDestination(directoryHandle)`: writes PNGs and a progress manifest into a fresh run folder. Obtain the writable handle with `showDirectoryPicker({mode: "readwrite"})` from a user gesture.
- `saveFileToDirectory(directoryHandle, job, blob, signal)`: saves a finalized MP4 into a fresh run folder. Await it before reporting success.
- `WebSocketDestination({url, token, timeoutMs?})`: implements `RenderDestination` for resumable PNG sequences. `saveMp4(job, blob, signal)` authenticates, uploads a finalized MP4 (up to 256 MiB), waits for persistence acknowledgement, and disconnects. MP4 uploads are not resumable.

`RenderJob.fileName?` sets the output filename prefix separately from the internal job ID. It accepts 1–80 letters, digits, underscores, or hyphens. The panel generates a fresh job ID for each render.

`RenderPanel.addSequenceResult(sequence, channel?)` retains a PNG sequence with playback, scrubbing, and ZIP download. `addResult(blob, filename, channel?)` retains a PNG or MP4. Both replace the selected channel's previous result and release its object URLs. Deleting a result or disposing the panel releases its URLs and playback timers.

`RenderPanelOptions.maxRetainedBytes` limits total retained output across channels (default 256 MiB). PNG frames and the sequence ZIP both count toward it. A result exceeding the limit is rejected while the previous result remains. Encoding and temporary copies add memory beyond this retained-output limit. `renderIcon(key, document)` optionally supplies icon elements; `setTransparencySupported(boolean)` lets an application disable transparency when selecting an opaque format such as MP4.

## Controlled recording settings

`createRecordingSettings(initial)` creates a framework-independent settings store.
Snapshots are immutable and stable until a setting changes. `subscribe(listener)`
notifies on changes only and returns an unsubscribe function. `updateSettings(patch)`
applies the entire patch atomically; explicit `undefined` clears optional settings.
Job IDs and content identity are excluded from settings snapshots.

Pass the store as `RenderPanelOptions.settings` to share settings with custom
controls or persistence. Existing integrations may instead use
`panel.updateSettings(patch)`, `panel.subscribeSettings(listener)`, and
`panel.settings.getSnapshot()`. No synthetic DOM events are necessary.

```ts
const unsubscribe = panel.subscribeSettings(() => {
  saveSettings(panel.settings.getSnapshot());
});
panel.updateSettings({ startFrame: 12, endFrame: 60 });
panel.updateSettings({ sampleIntervalSeconds: undefined });
// On unmount: unsubscribe(); The application still owns the session.
```

The model holds editable drafts, including temporarily invalid numbers while typing.
`validateJob` and `session.start` validate the execution snapshot. A render already
in progress keeps its original job; subsequent settings edits affect future jobs.

### Preparation ownership and cancellation

The lifecycle is: validate job → optional read-only `capture.check(job, {signal})`
→ destination open → animation acquire → capture prepare → frames → destination
close → capture finish → animation restore → deferred cleanup. Acquisition happens
before capture preparation so live animation/render writers cannot race export setup.

`acquire(context?)` and `prepare(settings, context?)` receive a shared
`PreparationContext` with `signal` and `defer(cleanup)`. Existing adapters that ignore
these extra arguments continue to work. Pass the signal into asynchronous waits;
cancellation is cooperative and cannot forcibly interrupt third-party GPU calls.
Register rollback immediately after acquiring each resource when a later step can
fail. Deferred callbacks run exactly once in reverse registration order on success,
failure, or cancellation, after normal finish/restore. Make resource releases safe
if normal cleanup already released them. An acquire that throws does not trigger
`restore` with a nonexistent snapshot; its registered deferrals still run.

`finish` runs after attempted prepare, even when preparation fails. All cleanup
steps are attempted. Multiple errors are retained in `AggregateError.errors` with
individual causes instead of losing the original failure. Cleanup failures remain
failures even if cancellation was requested. `dispose()` is idempotent and rejects
new jobs immediately, while waiting for cooperative work and cleanup to finish.

### Captured-frame validation and diagnostics

The session validates each captured frame before preview listeners or destinations
receive it: positive integer dimensions matching the execution job, a `Uint8Array`,
and exactly `width * height * 4` packed bytes. Subarrays and cross-window buffers
are supported. `validateCapturedFrame(frame, expected?)` is also public; it throws
`InvalidFrameError` with code `INVALID_FRAME`. Color space, origin and alpha semantics
remain adapter responsibilities verified by image-based tests.

`Progress.diagnostics` reports immutable `{code, phase, jobId, frame?, message}`
entries for execution and cleanup failures. `error` remains the legacy display
string; thrown original errors and aggregate causes are preserved. Diagnostics
reset for each run, and ordinary cancellation does not report a failure.

### Resolution and source-time mapping

Optional `resolutionMultiplier` scales base width/height at session execution for
stills and sequences. `resolveResolution(settings)` returns rounded integer output
dimensions. `resolveRenderSettings(settings)` returns an execution copy with the
multiplier removed, making resolution idempotent. Neither mutates the settings
store. Odd MP4 dimensions remain an explicit encoder constraint, not silently
adjusted by resolution scaling.

`frameSceneTime(frame, fps, interval?)` and `lastRecordingFrame(duration, step)`
centralize inclusive frame timing. `remapFrameRange({previous, next, previousStep,
nextStep, startFrame, endFrame})` preserves source timestamps between monotonic
`RecordingTimeline` mappings. Each mapping supplies `duration` (output-clock
seconds), `timeAt(positionSeconds)` and `positionAt(sourceTime)`. The application
owns speed, direction, gaps, and source-time units. Removed times snap to the nearest
retained frame; ranges are normalized for reverse playback. Restoring gaps does
not automatically expand an existing selection to the full duration.

## Composing the recording UI

`RenderPanel` remains the default assembly. Applications can instead mount
`RenderSettingsView`, `RenderPreview`, `RenderTransport`, and `RenderProgress`
independently from `three-recording-studio/ui`. Each takes `{ container,
controller, theme? }`; settings and preview also expose their specific options.
The shared `RenderController` is available from the root and UI entry points.

```ts
const controller = new RenderController({ session, job, destination });
const settings = new RenderSettingsView({
  container: settingsHost,
  controller,
  controls: { cameraFit: false, frameRange: false },
});
const preview = new RenderPreview({ container: previewHost, controller });
const transport = new RenderTransport({ container: toolbarHost, controller });
const progress = new RenderProgress({ container: statusHost, controller });
settings.slots.frameRange.append(customTimeline);
settings.slots.afterDimensions.append(customResolutionControl);
controller.settings.updateSettings({ startFrame: 10, endFrame: 90 });
```

Slots are stable mount points; custom controls write to `controller.settings`.
Hidden built-in controls are removed from the DOM, without removing their values
from the model. `preview.toolbar` is the supported toolbar extension point.
The default panel exposes the same components through `settingsView`,
`previewView`, `transport`, and `progress`, and its controller as `recording`.

Controller commands `start()`, `preview()`, and `renderImage()` report failures
through `error` and reject for programmatic callers. `subscribe()` immediately
notifies and returns an unsubscribe function. Transport buttons display failures
through the shared progress view. The compatibility panel retains its existing
non-throwing command methods.

Dispose each view on unmount. Views may be removed and recreated during a render;
this does not cancel the session. Dispose the controller when no longer needed,
and separately `await session.dispose()` when the application releases recording
resources. Retained results belong to the controller or an externally supplied result store,
so removing a preview does not discard completed recordings.

## Retaining results and retrying saves

`RenderResults` owns completed blobs independently of a preview. Pass it as
`results` to a controller or panel to retain recordings across disposal and
remounting. Otherwise the controller owns a default store and disposes it with
itself. Previews own and release their object URLs; they never delete shared
results when unmounted.

`getSnapshot()` returns a stable immutable array until results change. Each
result has an ID, channel, filename, blob, creation time, retained byte count,
and optional job, PNG sequence, and thumbnail. `add()` replaces that channel's
result atomically. An oversized replacement preserves the previous recording.
The default 256 MiB ceiling counts output blobs, sequence frame blobs, and
thumbnails; it is not a total browser-memory quota. `remove(id)` releases the
store's references. Application-held references remain the application's
responsibility.

```ts
const results = new RenderResults({ maxBytes: 256 * 1024 * 1024 });
const result = results.add({ blob, filename: "recording.mp4", job });
try {
  await results.save(result.id, async (recording, signal) => {
    const response = await fetch(uploadUrl, {
      method: "POST",
      body: recording.blob,
      signal,
    });
    if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
  });
} catch {
  // Keep playback/download available and offer results.retry(result.id).
}
```

Saving has its own `unsaved`, `saving`, `saved`, or `failed` state, read through
`getSaveState(id)` and observed with `subscribe()`. In React, subscribe using
`getSaveState(id)` as the snapshot getter for a save indicator. A failed save
retains the same result for retry. Concurrent saves of one result share one
promise. Removal, replacement, and disposal abort its writer; writers must honor
the signal. Cancellation cannot undo a remote upload that has already completed.
Catch save failures independently of rendering when invoking saves from a
render destination's completion callback.

`controller.addResult(input)` retains an output and attaches the active job and
first-frame thumbnail when available. Automatic thumbnails are at most 320 pixels
on either side. `createFrameThumbnail(frame, maxSize?)` is also public for custom
capture integrations; it copies the borrowed pixels before asynchronous PNG
encoding. `setThumbnail(id, blob)` can attach a thumbnail later. Thumbnail updates
and saving-state changes do not restart preview playback.
