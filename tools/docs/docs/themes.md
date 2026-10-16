# Panel and themes

```ts
import { RenderPanel } from "three-recording-studio/ui";
import "three-recording-studio/ui/style.css";

const panel = new RenderPanel({
  container: document.querySelector("#render-controls")!,
  previewContainer: document.querySelector("#render-preview")!, // optional
  session,
  job,
  destination: (job) => createDestination(job),
  theme: {
    background: "#171a20",
    surface: "#252b34",
    text: "#eef2f8",
    muted: "#a0aabc",
    accent: "#b4caff",
    border: "#364152",
    radius: "6px",
    space: "12px",
    font: "Inter, system-ui, sans-serif",
    "control-height": "32px",
  },
});
```

The layout and interactions are defined by the library. Theme values alter appearance rather than changing behavior. The same tokens can be set with scoped `--trs-*` CSS variables. `panel.setTheme()` updates controls and a separately mounted preview together. Built-in icons are inline SVG. Icon overrides are plain text, not injected HTML. Set `color-scheme` to `light` or `dark` to theme native controls.

The panel can be embedded or float within the page. The floating panel can be dragged by its header and resized. Set `allowFloating: false` to omit the Float panel button. Native browser pop-out windows are outside this release.

## Preview controls

Fit shows the entire image. 100% maps one output pixel to one physical display pixel using the current device pixel ratio. Wheel zoom is anchored under the cursor. Drag pans the image. With preview focused, use arrows to pan, plus/minus to zoom, and zero to fit.

Preview navigation never modifies the camera or the saved image. Use **Preview frame** to evaluate `currentFrame()` (or the first frame of the selected range when no callback is supplied) through the exact export pipeline. The displayed image is the last captured frame, not an independent realtime approximation.

## Lifecycle

Create one panel for each mounted view and call `dispose()` when removing it. The panel removes its observers and event listeners; the session continues to belong to the application. Progress subscriptions receive snapshots. Frame callbacks borrow capture storage; copy the pixels before retaining them asynchronously.

## Render channels and downloads

The preview includes channels and a history of completed results in each channel. **Render image** captures `currentFrame()` as a PNG at the configured output size. Supply `currentFrame: () => Math.round(time * fps)` to follow your application playhead. **Download** saves the selected result; no automatic download occurs. MP4 results play in the preview with native video controls. Still images support fit, zoom, and pan.

To retain an encoded animation, capture `panel.channel` when creating the destination and call `panel.addResult(blob, filename, channel)` in its completion callback. Each result is appended, preserving earlier renders. Channels are result slots, not color/depth render passes or parallel render sessions. **Delete render** releases a selected result. Results remain in memory until deletion or panel disposal; reloads do not preserve them. PNG sequences saved by a receiver remain on disk and are not loaded into this in-memory gallery.
