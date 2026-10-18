import { expect, it, vi } from "vitest";
import { createRecordingSettings } from "../src/core/settings";
const initial = {
  width: 1920,
  height: 1080,
  fps: 30,
  startFrame: 0,
  endFrame: 179,
};
it("publishes atomic immutable snapshots and ignores no-op patches", () => {
  const settings = createRecordingSettings(initial);
  const first = settings.getSnapshot();
  const changed = vi.fn();
  const unsubscribe = settings.subscribe(changed);
  settings.updateSettings({ width: 1920 });
  expect(settings.getSnapshot()).toBe(first);
  expect(changed).not.toHaveBeenCalled();
  settings.updateSettings({ startFrame: 10, endFrame: 20 });
  expect(changed).toHaveBeenCalledTimes(1);
  expect(settings.getSnapshot()).toMatchObject({
    startFrame: 10,
    endFrame: 20,
  });
  expect(first.startFrame).toBe(0);
  expect(Object.isFrozen(settings.getSnapshot())).toBe(true);
  unsubscribe();
  settings.updateSettings({ fps: 60 });
  expect(changed).toHaveBeenCalledTimes(1);
});
it("clears optional sampling and excludes run identities from persistence", () => {
  const settings = createRecordingSettings({
    ...initial,
    sampleIntervalSeconds: 2,
    ...{ id: "run", contentId: "scene" },
  });
  settings.updateSettings({ sampleIntervalSeconds: undefined });
  expect(JSON.parse(JSON.stringify(settings.getSnapshot()))).toEqual(initial);
});
it("retains draft values for execution validation rather than silently rendering old values", () => {
  const settings = createRecordingSettings(initial);
  settings.updateSettings({ width: 0 });
  expect(settings.getSnapshot().width).toBe(0);
});
