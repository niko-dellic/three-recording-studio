import { expect, it } from "vitest";
import {
  lastRecordingFrame,
  frameSceneTime,
  remapFrameRange,
  type RecordingTimeline,
} from "../src/core/timeline";
const full: RecordingTimeline = {
  duration: 20,
  timeAt: (s) => s * 5,
  positionAt: (m) => m / 5,
};
const active: RecordingTimeline = {
  duration: 4,
  timeAt: (s) => (s < 2 ? 10 + s * 5 : 80 + (s - 2) * 5),
  positionAt: (m) =>
    m < 10
      ? 0
      : m <= 20
        ? (m - 10) / 5
        : m < 80
          ? 2
          : Math.min(4, 2 + (m - 80) / 5),
};
it("preserves times when gaps return and snaps either side of removed gaps", () => {
  expect(
    remapFrameRange({
      previous: active,
      next: full,
      previousStep: 1,
      nextStep: 1,
      startFrame: 1,
      endFrame: 3,
    }),
  ).toEqual({ startFrame: 3, endFrame: 17 });
  expect(
    remapFrameRange({
      previous: full,
      next: active,
      previousStep: 1,
      nextStep: 1,
      startFrame: 5,
      endFrame: 15,
    }),
  ).toEqual({ startFrame: 1, endFrame: 2 });
});
it("normalizes reverse ranges, changed sampling, and clamps edges", () => {
  const reverse = {
    duration: 20,
    timeAt: (s: number) => 100 - s * 5,
    positionAt: (m: number) => (100 - m) / 5,
  };
  expect(
    remapFrameRange({
      previous: full,
      next: reverse,
      previousStep: 1,
      nextStep: 0.5,
      startFrame: 3,
      endFrame: 17,
    }),
  ).toEqual({ startFrame: 6, endFrame: 34 });
  expect(
    remapFrameRange({
      previous: full,
      next: active,
      previousStep: 1,
      nextStep: 1,
      startFrame: 0,
      endFrame: 19,
    }),
  ).toEqual({ startFrame: 0, endFrame: 3 });
});
it("handles fractional sampling and zero duration explicitly", () => {
  expect(lastRecordingFrame(6, 1 / 30)).toBe(179);
  expect(lastRecordingFrame(0, 1)).toBe(0);
  expect(frameSceneTime(3, 30, 0.5)).toBe(1.5);
  expect(() => lastRecordingFrame(4, 0)).toThrow();
  expect(() => frameSceneTime(-1, 30)).toThrow();
});
