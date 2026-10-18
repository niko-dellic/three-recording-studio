# Changelog

## 0.2.0 — 18 October 2026

- Public controlled settings, composable recording views, extension slots, and a shared controller replace private DOM integration.
- Results, thumbnails, bounded retention, and retryable saving have an independent lifetime from preview views and render sessions.
- Cooperative acquisition/preparation cancellation, deferred cleanup, packed-frame validation, and structured diagnostics harden custom adapters.
- Capability discovery and preflight validate capture and destinations before scene acquisition.
- Shared resolution scaling and source-time frame-range mapping preserve application timelines and avoid double scaling.
- One fullscreen control follows live preview and completed playback without cancelling recording.
- PNG and MP4 encoding compose with memory, folder, receiver, or custom storage. Opt-in fragmented MP4 streaming supports seekable folder writers with cancellation cleanup.
- Renderer-neutral core and narrow capture exports support applications without Three.js. Existing root imports and RenderPanel remain compatible.
- Public adapter conformance tests, strict packed-consumer checks, and runnable vanilla/React recipes cover lifecycle, hidden views, and backend retry.
- Patched the development documentation toolchain; full dependency audit reports no known vulnerabilities.

## 0.1.0 — 16 October 2026

Initial release for Three.js 0.186.x.

- Frame-exact WebGL and native WebGPU capture with independent output framing, alpha, and scene/renderer restoration.
- Seekable animation integration, inclusive frame ranges, optional timelapse sampling, progress, pause, cancellation, and resumable PNG receiver output.
- PNG sequences and H.264 MP4, with memory, browser folder, and authenticated receiver destinations in the demo.
- Optional themed render panel with preview channels, PNG/MP4 playback, scrubbing, explicit downloads, and bounded retained output.
- Quilt demo with live camera views, guides, presets, and docked Theatre keyframes. Neither framework is required by library consumers.
- ESM, TypeScript declarations, optional encoding dependency, and the `three-recording-receiver` CLI.

Verified browser scope is Chrome on macOS. MP4 encoding and folder picking depend on browser capabilities. MP4 is opaque and buffered until finalization; PNG receiver output supports durable resume. Audio, automatic simulation checkpoints, distributed rendering, and automatic React Three Fiber integration are outside this release.
