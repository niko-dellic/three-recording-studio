# Camera and rendering

Output dimensions are physical output pixels, independent of the interactive canvas, CSS dimensions, and device pixel ratio. Both capture adapters use offscreen render targets. They borrow the application's renderer during exclusive export and restore the state they modify.

## Camera fit

The export camera is cloned from the current camera for every frame, preserving its world transform. Source camera properties are not changed.

- `horizontal`: preserve horizontal field of view; adjust vertical framing.
- `vertical`: preserve vertical field of view; adjust horizontal framing.
- `auto` (default): use the source camera's larger image dimension as a virtual sensor anchor, then fit it to the output's larger dimension.

For a 4:3 perspective camera exported at 3:1, auto preserves the left/right boundaries and reveals less vertically. This mirrors Blender's sensor-fit concept without requiring physical sensor dimensions. Perspective and orthographic cameras are supported. Source view offsets are cleared for full-frame export; tiled camera exports are not supported.

## Color and transparency

The capture contract is top-left-origin, display-ready sRGB RGBA8. The WebGL adapter renders linear scene color to a half-float target, applies Three.js `OutputPass`, and flips the readback vertically. The WebGPU adapter uses the renderer's output target and its output conversion.

`transparent: true` sets the clear alpha to zero; the application must also remove an opaque `scene.background` and any full-screen background geometry if transparency is intended. PNG supports alpha. H.264 MP4 is opaque and rejects transparent jobs.

## Postprocessing

WebGL integrations can supply a `render(renderer, target, camera, context)` callback. It must write **linear scene color** into the supplied target, resize all participating passes to the target dimensions, and omit its final `OutputPass` because the adapter owns output conversion.

WebGPU integrations can supply an equivalent callback. It must use the configured output target and apply the renderer's final output conversion exactly once. The application is responsible for restoring any extra pipeline state changed by custom callbacks. Arbitrary EffectComposer chains are not automatically adapted.

## GPU completion

Rendering submits GPU work. Capture waits for asynchronous render-target readback before exposing pixels. Only one frame is in flight in this release, and destinations must finish consuming a borrowed buffer before resolving `write()`.

The default sample count is four, bounded by WebGL hardware capability; WebGPU accepts zero or four. Unsupported dimensions fail before scene acquisition. Device loss or readback errors fail the job and trigger cleanup. There is no silent resolution reduction or backend substitution.

## Stencil clipping caps

Set `stencil: true` on the renderer and capture adapter for scenes that use stencil materials. This allocates a stencil buffer in the viewport and the export target. The demo uses clipped back-face and front-face passes to mark the cut area. A separate plane fills that area. The plane moves with the clipping height.
