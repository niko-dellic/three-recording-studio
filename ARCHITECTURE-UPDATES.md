# Integration architecture improvements

Goal: implement all twelve recommendations from the PreFORM integration review,
with a separate commit per improvement, migrate PreFORM to the public APIs, and
publish a tested npm release. Existing imports and RenderPanel remain compatible.
Target release: 0.2.0 (new public APIs; final version checked against npm before publishing).

- [x] 1. Public, framework-independent recording settings model; panel binding.
- [x] 2. Cooperative acquisition/preparation cancellation and reliable cleanup.
- [x] 3. Composable preview, settings, transport, progress, and extension points.
- [x] 4. Shared render results, retention, thumbnails, and independent saving/retry.
- [x] 5. Capability discovery and preflight validation.
- [x] 6. Shared resolution and timeline mapping utilities.
- [x] 7. Unified preview/fullscreen ownership, independent of session lifetime.
- [x] 8. Frame-boundary validation and structured diagnostics.
- [x] 9. Encoding/storage composition, buffered default and supported streaming.
- [x] 10. Reusable adapter contracts and consumer regression harness.
- [x] 11. Complete runnable integration recipes and lifecycle documentation.
- [x] 12. Renderer-neutral and narrow capture entry points.
- [x] Migrate and verify PreFORM without private input selectors/events or hidden settings CSS.
- [x] Final unit/browser/package/site/format/type/build/security checks, clean release commit/tag.
- [ ] Publish npm, verify registry installation and release artifacts.

## Evidence

1. Settings unit tests plus existing session tests: 21 passed. Chrome public-settings
   and existing timelapse tests: 2 passed. Typecheck passed. The settings model
   supports editable drafts; execution validation remains in validateJob/start.

2. Lifecycle/settings tests: 27 passed; typecheck passed. Four real Chrome
   WebGL/WebGPU capture tests passed, including 4K readback, alpha, frame order,
   slow persistence, and renderer restoration. Added acquisition cancellation,
   partial preparation cleanup, multi-error preservation, and disposal regressions.

3. Frame validation added before all frame consumers; phase/job/frame diagnostics
   retain legacy error compatibility. Frame, session and readback regressions and
   typecheck pass. Implemented before UI decomposition so components share diagnostics.

4. Shared resolution/timeline utilities and execution scaling: 38 targeted unit
   tests and typecheck passed. Three focused Chrome tests passed, including actual
   2x still pixel dimensions with unchanged base settings, settings updates, and sampling.

Do not consider individual checkboxes a substitute for final requirement-by-requirement
verification. No npm publication until all work and release gates are complete.

5. Composable UI: extracted RenderController, RenderSettingsView, RenderPreview,
   RenderTransport and RenderProgress; RenderPanel is a compatibility assembly.
   Public control visibility and slots replace consumer DOM surgery. Typecheck,
   three controller lifecycle tests, all 38 existing Chrome tests and the new
   independent-view remount/extension test passed (39 browser cases total).

6. Shared results: RenderResults retains immutable recording snapshots with bounded
   blobs, metadata and first-frame thumbnails independently of preview object URLs.
   Save state/retry/cancellation are independent of rendering. Eight result/controller
   tests and six targeted Chrome behaviors passed, including remount, upload retry,
   still replacement, PNG playback, MP4 scrubber and destination callbacks.

7. Narrow imports: public /core, /destinations, and /capture/webgl, /webgpu,
   /camera exports with optional Three.js peer for custom capture consumers.
   Typecheck and clean packed installation pass; the verifier removes Three.js
   before loading core/UI/destinations and checks every new capture entry point.

8. Unified fullscreen: one preview-owned control moves between live/still toolbar,
   fullscreen overlay and completed playback bar. Preview navigation is restored
   on exit. Typecheck and five Chrome regressions pass, including completing an
   active render in fullscreen without duplicate controls or cancellation.

9. Capability discovery: optional adapter/destination descriptors and read-only
   checks produce structured reports before any output open or scene acquisition.
   Controller inspections follow edits and discard stale probes; UI applies support
   constraints. Typecheck, 35 targeted unit tests and five Chrome cases pass,
   including native WebGPU/WebGL, MP4 encoding and capability-driven feedback.

10. Encoding/storage composition: FileStorage supports memory, fresh folders,
    receiver and custom backend implementations for PNG/MP4; MP4 remains buffered
    by default with explicit fragmented streaming for capable storage. Stream
    cancellation aborts rather than commits files. Build/typecheck, 11 storage/
    receiver/memory unit cases, eight Chrome format/storage/stream regressions,
    and clean packed installation pass. Cleanup changes rechecked in three cases.

11. Public /testing adapter conformance harness runs fresh fixtures through success,
    cancellation, persistence/preparation/readiness failures and explicit hidden-view
    scenarios, checking consumer pixel/state assertions and cleanup. Four harness
    unit tests, six scenarios each against native WebGL/WebGPU in Chrome, and the
    same harness in a clean packed consumer without Three.js passed. Source paths
    let typechecking new public APIs run without stale generated declarations.

12. Runnable vanilla Three.js and React/custom-capture recipes include full lifecycle,
    remount, retained results and retryable local backend upload. Both browser
    acceptance tests, typecheck, production site build and built-site route checks pass.

13. PreFORM now uses settings updates/subscriptions, public slots/control visibility,
    shared resolution and timeline mapping, retained results with independent upload
    retry, and the library fullscreen owner. Removed private input events and CSS
    control hiding, plus scaling/fullscreen wrappers. Typecheck, 15 focused unit tests
    and both real backend browser tests pass. Dark/light/narrow screenshots reviewed.
    Broad PreFORM check stops in unrelated replica tooling (missing Python shapely).

14. Strict exact-optional packed consumers exposed an inferred MP4 capability type;
    fixed the declaration and added a clean-package TypeScript regression. Patched
    documentation Vite/esbuild dependencies; full npm audit reports zero findings.
    Final library checks: 86 unit tests, 52 Chrome browser cases, packed installation,
    type/build, static-site navigation and formatting all pass.

PreFORM migration committed as `28d5615f`; final 0.2.0 consumer typecheck, 15 focused tests and production build pass.
