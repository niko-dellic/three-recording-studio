# Compatibility and limitations

- Three.js 0.186.x is the initial compatibility range. New revisions require capture regression tests before widening the peer range.
- WebGL requires WebGL 2 and floating-point render-target support. WebGPU requires a native WebGPU device; the WebGPU adapter refuses an implicit WebGL fallback.
- MP4 support depends on browser, operating system and encoder limits. Capability checks report unsupported H.264 configurations before taking scene ownership.
- Render-target allocation consumes GPU memory. Hardware dimension limits are checked, but available memory cannot be reliably predicted. Allocation or device failures end the job and restore application state.
- Readback and PNG encoding are intentionally serialized for bounded frame memory. This release prioritizes correctness over overlapping GPU and encoding work.
- The receiver requires Node 24+. Documentation uses publisher-docs with exactly VitePress 1.6.4.
- No audio, automatic physics checkpoints, tiled rendering, distributed rendering, native window management, or automatic React Three Fiber integration is included.
- Custom postprocessing requires an integration callback; arbitrary pipelines are not automatically captured.

## Verification

Run `npm run check` for type checks, package build, unit/receiver tests, demo build, and docs build. Run `npm run test:browser` for real Chrome WebGL/WebGPU capture and MP4 tests. Native WebGPU must actually be available; these tests do not skip an unavailable backend and report success.

Keep development servers local. Publish static site builds rather than exposing Vite or VitePress development servers.
