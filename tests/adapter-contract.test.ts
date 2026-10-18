import { expect, it } from "vitest";
import {
  runAdapterContract,
  type AdapterFixture,
} from "../src/testing/index.js";
const job = {
  id: "contract",
  contentId: "fixture",
  width: 2,
  height: 1,
  fps: 10,
  startFrame: 0,
  endFrame: 2,
};
function fixture(broken = false): AdapterFixture {
  let acquired = false,
    prepared = false,
    time = 42;
  return {
    animation: {
      acquire() {
        acquired = true;
        return time;
      },
      seek(context) {
        time = context.time;
      },
      restore(snapshot) {
        acquired = false;
        if (!broken) time = snapshot as number;
      },
    },
    capture: {
      prepare() {
        prepared = true;
      },
      async capture() {
        return { width: 2, height: 1, pixels: new Uint8Array(8) };
      },
      finish() {
        prepared = false;
      },
      dispose() {},
    },
    assertFrame(_frame, context) {
      expect(acquired && prepared).toBe(true);
      expect(time).toBe(context.frame / 10);
    },
    assertRestored() {
      expect(acquired || prepared).toBe(false);
      expect(time).toBe(42);
    },
  };
}
it("runs complete, cancelled, and failure lifecycles against consumer adapters", async () => {
  const report = await runAdapterContract({
    job,
    createFixture: () => fixture(),
  });
  expect(report.passed).toBe(true);
  expect(report.cases).toHaveLength(5);
  expect(report.cases[0].frames).toEqual([0, 1, 2]);
});
it("detects restoration defects instead of accepting matching session state", async () => {
  const report = await runAdapterContract({
    job,
    createFixture: () => fixture(true),
  });
  expect(report.passed).toBe(false);
  expect(
    report.cases
      .find((result) => result.scenario === "complete")!
      .errors.join(" "),
  ).toContain("42");
});
it("does not silently pass hidden-view coverage without a detach hook", async () => {
  const report = await runAdapterContract({
    job,
    scenarios: ["hidden-view"],
    createFixture: () => fixture(),
  });
  expect(report.passed).toBe(false);
  expect(report.cases[0].errors.join(" ")).toContain("detachView");
});
it("retains cleanup assertion failures alongside capture failures", async () => {
  const report = await runAdapterContract({
    job,
    scenarios: ["complete"],
    createFixture: () => ({
      ...fixture(),
      assertFrame() {
        throw new Error("Wrong color");
      },
      dispose() {
        throw new Error("Fixture cleanup failed");
      },
    }),
  });
  expect(report.cases[0].errors).toHaveLength(2);
});
