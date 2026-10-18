# Integration architecture improvements

Goal: implement all twelve recommendations from the PreFORM integration review,
with a separate commit per improvement, migrate PreFORM to the public APIs, and
publish a tested npm release. Existing imports and RenderPanel remain compatible.
Target release: 0.2.0 (new public APIs; final version checked against npm before publishing).

- [x] 1. Public, framework-independent recording settings model; panel binding.
- [x] 2. Cooperative acquisition/preparation cancellation and reliable cleanup.
- [ ] 3. Composable preview, settings, transport, progress, and extension points.
- [ ] 4. Shared render results, retention, thumbnails, and independent saving/retry.
- [ ] 5. Capability discovery and preflight validation.
- [x] 6. Shared resolution and timeline mapping utilities.
- [ ] 7. Unified preview/fullscreen ownership, independent of session lifetime.
- [x] 8. Frame-boundary validation and structured diagnostics.
- [ ] 9. Encoding/storage composition, buffered default and supported streaming.
- [ ] 10. Reusable adapter contracts and consumer regression harness.
- [ ] 11. Complete runnable integration recipes and lifecycle documentation.
- [ ] 12. Renderer-neutral and narrow capture entry points.
- [ ] Migrate and verify PreFORM without private input selectors/events or hidden settings CSS.
- [ ] Final unit/browser/package/site/format/type/build/security checks, clean release commit/tag.
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
