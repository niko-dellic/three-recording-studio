# Changelog

## 0.1.0 — release candidate

Initial release for Three.js 0.186.x.

- Frame-exact WebGL and native WebGPU capture with independent output framing, alpha, and scene/renderer restoration.
- Seekable animation integration, inclusive frame ranges, optional timelapse sampling, progress, pause, cancellation, and resumable PNG receiver output.
- PNG sequences and H.264 MP4, with memory, browser folder, and authenticated receiver destinations in the demo.
- Optional themed render panel with preview channels, PNG/MP4 playback, scrubbing, explicit downloads, and bounded retained output.
- Quilt demo with live camera views, guides, presets, and docked Theatre keyframes. Neither framework is required by library consumers.
- ESM, TypeScript declarations, optional encoding dependency, and the `three-recording-receiver` CLI.

Verified browser scope is Chrome on macOS. MP4 encoding and folder picking depend on browser capabilities. MP4 is opaque and buffered until finalization; PNG receiver output supports durable resume. Audio, automatic simulation checkpoints, distributed rendering, and automatic React Three Fiber integration are outside this release.
