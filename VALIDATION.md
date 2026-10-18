# Validation — 18 October 2026

Release candidate: `three-recording-studio@0.2.0`. Repository: https://github.com/niko-dellic/three-recording-studio. Documentation and demo: https://three-recording-studio.vercel.app.

## Verified release checks

- `npm run check`: type checking, library build, **86 unit/integration tests**, demo build, docs build, assembled static site.
- `npm run test:browser`: **52 Chrome browser tests**, including native WebGPU; no skipped GPU cases.
- `npm run test:site`: built documentation navigation, search, light/dark themes, mobile layouts, and round-trip navigation to the demo.
- `npm run test:packed`: archive installation in a fresh consumer without optional encoding or demo dependencies; all destination exports, UI/styles/declarations, license/release notes, and actual packaged receiver startup/shutdown.
- `npm run format:check`: source formatting.
- Documentation guide TypeScript examples compile against the current package declarations.
- `npm publish --dry-run --json`: validates the public 0.2.0 payload without uploading it.
- `npm audit --omit=dev`: zero reported production dependency vulnerabilities at verification time.
- Publication and registry installation are verified separately after the release gates.

## Covered behavior

| Area              | Evidence                                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lifecycle         | Exclusive scheduling, readiness, pause/cancel, failure cleanup, scene restoration, inclusive frame ranges and timelapse sampling                    |
| WebGL/WebGPU      | Correct orientation, colors and alpha; renderer-state restoration; 3840 × 1280 exports; portrait row-padding regression; clipping and stencil caps  |
| MP4               | Decoded frame count, dimensions, timestamps and duration; memory-limit cleanup; Theatre playhead restoration                                        |
| PNG recovery      | Authentication, origin restrictions, atomic durable acknowledgement, resume of missing/corrupt frames, content identity checks                      |
| Destinations      | Memory/folder/receiver available for both formats; PNG ZIP playback and scrubbing; real filesystem handles; finalized MP4 folder and receiver files |
| Preview           | Channel replacement/deletion, explicit download, direct panning, custom video transport, smooth scrubber, hover keyboard playback and fullscreen    |
| Demo              | Quilt theme and responsive controls, independent camera views, guides, docked Theatre workspace, and custom-layout popout state restoration         |
| Package isolation | Core/UI imports work without Mediabunny, Quilt, Theatre, React or VitePress                                                                         |

Folder picker tests use real browser filesystem handles with a stubbed picker. The native OS permission dialog is not automated. Receiver MP4 transfers are finalized-file uploads and do not support resume. PNG receiver jobs support durable resume; folder exports always create a fresh run folder.

## Release boundaries

The verified browser is installed Google Chrome on this Mac using native WebGPU. Other browser/OS codec combinations are capability-dependent and are not claimed as verified. The initial Three.js peer range is 0.186.x. The receiver and repository tooling require Node 24+.

Memory PNG output defaults to 128 MiB including ZIP headers. MP4 encoding and retained channel results each default to 256 MiB. PNG frames and their ZIP both count toward retained-channel limits. These bound output sizes, not total process memory: codec queues, temporary copies, frame buffers and GPU allocations add overhead. Results held in memory do not survive reload.

Audio, automatic stateful-simulation checkpoints, tiled/distributed rendering and automatic React Three Fiber integration remain outside this release. Custom postprocessing requires an application hook. Quilt owns demo pane popouts; the core recording library does not provide native window management.

VitePress 1.6.4 uses a scoped Vite 6.4.4 override. The full dependency audit, including development tools, reports no known vulnerabilities. Development servers bind to loopback; deployment serves static output. Large demo bundles produce Vite size warnings; they are not shipped as library runtime dependencies.

## Artifacts

- `three-recording-studio-0.2.0.tgz`: npm archive with runtime, declarations, source maps/source, styles, receiver CLI, license and release notes.
- `site/`: static docs at `/`, `/guide`, `/api`, `/saving`, and demo at `/demo/`.
- `docs/media/studio.png` and `tools/docs/docs/public/studio.png`: current demo screenshot.
- `CHANGELOG.md`: initial release notes.
- `RELEASE.md`: reproducible release and publication procedure.

## Registry publication

Registry integrity: `sha512-y9UJp+C/+pBCrWwAupwtrA6a/ljV5EdvDG9VrQg1XqKyRCdqJBv/E4SLpHzz8fCu+n9p35R02zwAKlrAIwau4Q==`.

A fresh registry install of `three-recording-studio@0.2.0` with Three.js 0.186.1 verified core/UI/destination exports, the optional encoding entry point, stylesheet availability, and receiver startup/shutdown. Its lockfile integrity matched the registry; no demo framework dependencies were installed. The npm `latest` tag resolves to 0.2.0.

## 0.2.0 integration evidence

- 86 unit tests and 52 installed-Chrome browser tests pass, including native WebGPU.
- Clean packed consumer compiles with strict optional properties and imports renderer-neutral entry points after removing Three.js.
- Both complete integration recipes render real output; the React recipe unmounts its preview during rendering and retries an actual local backend upload.
- PreFORM migrates private input selectors/events and hidden-control CSS to public settings, slots, shared timeline/resolution utilities and one fullscreen owner. Its backend metadata and project settings remain application-owned.
- PreFORM's broad `npm run check` passes architecture/unused checks but stops in unrelated replica Python tooling because `shapely` is absent. Recording-specific validation is recorded independently.

PreFORM: both backend recording browser cases and all 15 focused unit tests passed; dark/light/narrow screenshots reviewed.
