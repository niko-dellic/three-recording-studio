# Validation — 15 October 2026

Implementation is local and unpublished. The static site and npm archive are built from this repository.

## Verified

| Requirement                                                      | Evidence                                                                                                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exclusive frame scheduling, readiness, restoration, pause/cancel | 19 passing unit/integration tests in `tests/session.test.ts`, `tests/camera.test.ts`, and `tests/receiver.test.ts`                                                        |
| WebGL and native WebGPU capture                                  | Chrome browser tests pass on both backends; independent adapter inspection reports Apple / metal-3 and `isFallbackAdapter: false`                                         |
| Independent 4K panoramic output                                  | Both backends export three 3840 × 1280 frames from the demo's 4:3 viewport, with a deliberately slow destination                                                          |
| Capture correctness                                              | Red/blue orientation, straight alpha including 50% opacity, and renderer viewport/scissor/size/clear-state restoration are checked on both backends                       |
| MP4                                                              | Decoded frame count, timestamps, dimensions and duration; memory-limit failure cleanup; actual demo-button download and Theatre playhead restoration                      |
| Durable PNG progress                                             | Files are acknowledged after atomic persistence; cancellation/reconnect resumes only missing frames; corrupt frames are detected; changed content identities are rejected |
| Demo recovery                                                    | Identity remains stable across repeated exports and page reloads                                                                                                          |
| Themed UI                                                        | Theme switching, embedded/floating mode, preview keyboard navigation, unchanged camera, and responsive mobile tabs                                                        |
| Publisher documentation                                          | Home/guide/API routes, native appearance persistence, search, mobile navigation, background/navbar/sidebar styling, and navigation to/from the built demo                 |
| Package isolation                                                | Archive installs in a clean temporary consumer; core/UI import without optional encoding dependencies; no Quilt/Theatre/React/VitePress dependency leakage                |

Commands completed successfully:

- `npm run check`: type checking, library build, 19 tests, demo build, docs build, assembled static site.
- `npm run test:browser`: 16 real-browser tests, without skipped GPU cases.
- `npm run test:site`: publisher-style static-site browser checks.
- `npm run test:packed`: clean-consumer installation and entry-point checks.
- `npm run format:check`: source formatting.
- `npm audit --omit=dev`: zero reported production dependency vulnerabilities at verification time.

## Deliverables

- `three-recording-studio-0.1.0.tgz`: installable npm artifact with source, declarations, runtime, styles and receiver CLI.
- `site/`: static documentation at `/docs/` and demo at `/demo/`.
- `docs/media/studio.png`: built demo screenshot.
- `tools/docs/docs/`: integration guide, API contracts, themes, saving/recovery and compatibility documentation.

## Explicit boundaries

The tested browser is Google Chrome on this Mac. Other browser/OS codec combinations are capability-dependent and are not claimed as verified. The initial Three.js peer range is 0.186.x.

General stateful simulation checkpoints, audio, automatic React Three Fiber integration, native pop-out windows and distributed rendering are outside the agreed first release. Custom postprocessing requires an application hook. MP4 recovery after page reload restarts the file; durable recovery uses PNG sequences.

The MP4 limit bounds encoded output size, not total process memory. Codec queues, readback buffers, GPU allocations and temporary copies add overhead. Four-sample capture and output conversion are tested; arbitrary custom material/pipeline combinations still require integration testing.

The requested VitePress 1.6.4 documentation stack retains development-tool advisories in its transitive dependencies (3 moderate and 1 high reported in the full dependency audit). Production package dependencies have no reported advisories. Development servers bind to loopback; deployment uses static files. The demo currently bundles Theatre Studio with the scene, producing a roughly 716 kB gzip initial script; code splitting is a future optimization.

No npm publication, remote GitHub repository, or hosted deployment was performed.

## Demo refinement

Quilt neutral theme and border resize mode, compact fullscreen toolbar, responsive icon transport, and a separate brief homepage are implemented. The demo uses the requested bunny VTK asset with Theatre keyframes driving a clipping plane. Pixel-count checks verify clipping on both WebGL and native WebGPU. Fullscreen entry/exit and mobile transport wrapping pass browser tests.

Render gallery: MP4 replay and explicit download, current-playhead PNG capture, channel switching, and preservation of previous results pass browser checks. Results are held in memory until deletion/disposal and do not survive page reload. The demo hides floating-panel controls.

PNG destination selection: folder writes tested with real browser filesystem handles via a stubbed native picker, including decoded PNG dimensions, unique run folders, current-frame export, cancellation of folder selection, and unsupported-picker fallback. Native OS dialog interaction is not automated.
