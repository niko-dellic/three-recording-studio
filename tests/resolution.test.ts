import { expect, it } from "vitest";
import {
  resolveResolution,
  resolveRenderSettings,
} from "../src/core/resolution";
const settings = {
  width: 1920,
  height: 1080,
  fps: 30,
  startFrame: 0,
  endFrame: 1,
  resolutionMultiplier: 2,
};
it("scales both dimensions once without mutating base settings", () => {
  const result = resolveRenderSettings(settings);
  expect(result).toMatchObject({ width: 3840, height: 2160 });
  expect(resolveRenderSettings(result)).toEqual(result);
  expect(settings.width).toBe(1920);
  expect(settings.resolutionMultiplier).toBe(2);
  expect(resolveResolution({ ...settings, resolutionMultiplier: 0.5 })).toEqual(
    { width: 960, height: 540 },
  );
});
it.each([0, -1, NaN, Infinity])(
  "rejects invalid multiplier %s",
  (resolutionMultiplier) => {
    expect(() =>
      resolveResolution({ ...settings, resolutionMultiplier }),
    ).toThrow();
  },
);
