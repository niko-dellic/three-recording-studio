import { RenderSession } from "../core/session.js";
import { resolveRenderSettings } from "../core/resolution.js";
import type {
  AnimationAdapter,
  CaptureAdapter,
  CapturedFrame,
  FrameContext,
  RenderJob,
} from "../core/types.js";

export type AdapterScenario =
  | "complete"
  | "cancel"
  | "write-failure"
  | "prepare-failure"
  | "ready-failure"
  | "hidden-view";
export interface AdapterFixture {
  animation: AnimationAdapter;
  capture: CaptureAdapter;
  /** Assert scene-specific pixels, orientation, colors and evaluated time. Pixels are borrowed. */
  assertFrame(
    frame: CapturedFrame,
    context: FrameContext,
  ): void | Promise<void>;
  /** Assert application time, playback/locks, camera and renderer state after the run. */
  assertRestored(): void | Promise<void>;
  /** Required when explicitly including the hidden-view scenario. */
  detachView?(): void | Promise<void>;
  /** Release fixture-owned renderers, DOM, and data after capture disposal. */
  dispose?(): void | Promise<void>;
}
export interface AdapterContractCase {
  readonly scenario: AdapterScenario;
  readonly frames: readonly number[];
  readonly passed: boolean;
  readonly errors: readonly string[];
}
export interface AdapterContractReport {
  readonly passed: boolean;
  readonly cases: readonly AdapterContractCase[];
}
const defaults: readonly AdapterScenario[] = [
  "complete",
  "cancel",
  "write-failure",
  "prepare-failure",
  "ready-failure",
];

/** Framework-independent conformance runner; each scenario uses a fresh fixture.
 * Use a test-runner timeout: uncooperative adapter/GPU work cannot be forcibly stopped.
 */
export async function runAdapterContract(options: {
  job: RenderJob;
  createFixture(
    scenario: AdapterScenario,
  ): AdapterFixture | Promise<AdapterFixture>;
  scenarios?: readonly AdapterScenario[];
}): Promise<AdapterContractReport> {
  const cases: AdapterContractCase[] = [];
  const job = resolveRenderSettings(options.job);
  if (job.endFrame - job.startFrame < 1)
    throw new Error("Adapter contract requires at least two frames");
  const scenarios = options.scenarios ?? defaults;
  if (!scenarios.length)
    throw new Error("Select at least one adapter contract scenario");
  for (const scenario of scenarios) {
    const errors: string[] = [];
    const frames: number[] = [];
    let fixture: AdapterFixture | undefined;
    let session: RenderSession | undefined;
    let restored = 0,
      finished = 0,
      expectedFailure = false;
    const fault = new Error(`Contract injected ${scenario}`);
    try {
      fixture = await options.createFixture(scenario);
      const { animation, capture } = fixture;
      session = new RenderSession({
        animation: {
          acquire: (context) => animation.acquire(context),
          seek: (context) => animation.seek(context),
          ready: async (context) => {
            await animation.ready?.(context);
            if (scenario === "ready-failure") throw fault;
          },
          restore: async (snapshot) => {
            restored++;
            await animation.restore(snapshot);
          },
        },
        capture: {
          capabilities: (context) => capture.capabilities?.(context) ?? {},
          check: (settings, context) => capture.check?.(settings, context),
          prepare: async (settings, context) => {
            await capture.prepare(settings, context);
            if (scenario === "prepare-failure") throw fault;
            if (scenario === "hidden-view") {
              if (!fixture!.detachView)
                throw new Error("hidden-view requires detachView");
              await fixture!.detachView();
            }
          },
          capture: async (context) => {
            const frame = await capture.capture(context);
            await fixture!.assertFrame(frame, context);
            frames.push(context.frame);
            return frame;
          },
          finish: async () => {
            finished++;
            await capture.finish();
          },
          dispose: () => capture.dispose(),
        },
      });
      if (scenario === "cancel") session.onFrame(() => session!.cancel());
      try {
        await session.start(job, {
          async open() {
            return new Set<number>();
          },
          async write(_frame, context) {
            context.signal.throwIfAborted();
            if (scenario === "write-failure") throw fault;
          },
          async close() {},
          async abort() {},
        });
      } catch (error) {
        // Cleanup errors must not be mistaken for the deliberately injected fault.
        if (error === fault) expectedFailure = true;
        else throw error;
      }
      const injected = [
        "write-failure",
        "prepare-failure",
        "ready-failure",
      ].includes(scenario);
      const expectedState = injected
        ? "failed"
        : scenario === "cancel"
          ? "cancelled"
          : "completed";
      if (
        session.status.state !== expectedState ||
        expectedFailure !== injected
      )
        throw new Error(
          `Expected ${expectedState}, got ${session.status.state}`,
        );
      if (restored !== 1 || finished !== 1)
        throw new Error(
          `Expected one restore/finish, got ${restored}/${finished}`,
        );
      const count = ["prepare-failure", "ready-failure"].includes(scenario)
        ? 0
        : ["cancel", "write-failure"].includes(scenario)
          ? 1
          : job.endFrame - job.startFrame + 1;
      if (
        frames.length !== count ||
        frames.some((frame, index) => frame !== job.startFrame + index)
      )
        throw new Error(
          "Capture frame order/count does not match the scenario",
        );
    } catch (error) {
      errors.push(String(error));
    }
    // Always inspect restoration, including when frame assertions or cleanup failed.
    try {
      await fixture?.assertRestored();
    } catch (error) {
      errors.push(String(error));
    }
    try {
      await session?.dispose();
    } catch (error) {
      errors.push(String(error));
    }
    try {
      await fixture?.dispose?.();
    } catch (error) {
      errors.push(String(error));
    }
    cases.push(
      Object.freeze({
        scenario,
        frames: Object.freeze(frames),
        passed: !errors.length,
        errors: Object.freeze(errors),
      }),
    );
  }
  return Object.freeze({
    passed: cases.every((result) => result.passed),
    cases: Object.freeze(cases),
  });
}
