import { expect, it, vi } from "vitest";
import { inspectRender } from "../src/core/capabilities.js";
import { RenderSession } from "../src/core/session.js";
import { RenderController } from "../src/core/controller.js";
import type {
  CaptureAdapter,
  RenderDestination,
  RenderJob,
} from "../src/core/types.js";
const job: RenderJob = {
  id: "probe",
  contentId: "scene",
  width: 320,
  height: 180,
  fps: 30,
  startFrame: 0,
  endFrame: 9,
};
function fixture() {
  const capture: CaptureAdapter = {
    prepare: vi.fn(),
    capture: vi.fn(),
    finish: vi.fn(),
    dispose: vi.fn(),
  };
  const destination: RenderDestination = {
    open: vi.fn(async () => new Set<number>()),
    write: vi.fn(),
    close: vi.fn(),
    abort: vi.fn(),
  };
  const animation = { acquire: vi.fn(), seek: vi.fn(), restore: vi.fn() };
  const session = new RenderSession({ capture, animation });
  return { capture, destination, animation, session };
}

it("reports effective dimensions and both constraint sources without opening or acquiring", async () => {
  const { capture, destination, animation, session } = fixture();
  capture.capabilities = () => ({
    maxWidth: 500,
    cameraFit: true,
    transparent: true,
  });
  destination.capabilities = () => ({
    transparent: false,
    maxFrames: 2,
    widthMultiple: 2,
  });
  const report = await session.inspect(
    { ...job, resolutionMultiplier: 2, transparent: true },
    destination,
  );
  expect(report.valid).toBe(false);
  expect(report.job!.width).toBe(640);
  expect(report.job!.resolutionMultiplier).toBeUndefined();
  expect(report.issues.map((issue) => issue.source)).toEqual([
    "capture",
    "destination",
    "destination",
  ]);
  expect(destination.open).not.toHaveBeenCalled();
  expect(animation.acquire).not.toHaveBeenCalled();
  expect(capture.prepare).not.toHaveBeenCalled();
  await expect(
    session.start({ ...job, transparent: true }, destination),
  ).rejects.toThrow("Transparent output");
  expect(destination.open).not.toHaveBeenCalled();
  expect(animation.acquire).not.toHaveBeenCalled();
});

it("preserves legacy adapters with unknown capabilities and validates editable drafts", async () => {
  const { capture, destination } = fixture();
  expect((await inspectRender(job, capture, destination)).valid).toBe(true);
  const report = await inspectRender(
    { ...job, width: 0 },
    capture,
    destination,
  );
  expect(report.valid).toBe(false);
  expect(report.issues[0].source).toBe("settings");
  expect(report.capture.transparent).toBeUndefined();
});

it("reports codec/check failures independently and honors cooperative cancellation", async () => {
  const { capture, destination } = fixture();
  destination.check = async () => {
    throw new Error("No H.264 codec");
  };
  expect((await inspectRender(job, capture, destination)).issues).toEqual([
    { source: "destination", message: "No H.264 codec" },
  ]);
  const abort = new AbortController();
  capture.capabilities = async () => {
    abort.abort();
    return {};
  };
  await expect(
    inspectRender(job, capture, destination, abort.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});

it("rechecks on settings edits and ignores stale destination inspection", async () => {
  const { session, destination } = fixture();
  const controller = new RenderController({
    session,
    job,
    destination: () => {
      throw new Error("Picker must not run");
    },
  });
  let release!: () => void;
  const old: RenderDestination = {
    ...destination,
    capabilities: async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { maxWidth: 1 };
    },
  };
  const first = controller.inspect(old);
  // The capture discovery precedes destination discovery.
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  destination.capabilities = () => ({ maxWidth: 400 });
  const newer = await controller.inspect(destination);
  expect(newer.valid).toBe(true);
  release();
  await expect(first).rejects.toMatchObject({ name: "AbortError" });
  expect(controller.inspection).toBe(newer);
  controller.settings.updateSettings({ width: 500 });
  await vi.waitFor(() => expect(controller.inspection?.valid).toBe(false));
  expect(controller.inspection!.destination.maxWidth).toBe(400);
  expect(destination.open).not.toHaveBeenCalled();
  controller.dispose();
  await session.dispose();
});
