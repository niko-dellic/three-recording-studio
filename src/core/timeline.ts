/** An application-defined mapping from output-clock seconds to source time.
 * Source-time units are arbitrary but must match between mappings. Applications
 * own inactive intervals, speed and direction; mappings must be monotonic.
 */
export interface RecordingTimeline {
  readonly duration: number;
  timeAt(positionSeconds: number): number;
  positionAt(sourceTime: number): number;
}
function validStep(step: number) {
  if (!Number.isFinite(step) || step <= 0)
    throw new Error("Frame interval must be positive and finite");
}
export function lastRecordingFrame(duration: number, step: number) {
  validStep(step);
  if (!Number.isFinite(duration) || duration < 0)
    throw new Error("Timeline duration must be finite and nonnegative");
  const last = Math.max(0, Math.ceil(duration / step) - 1);
  if (!Number.isSafeInteger(last))
    throw new Error("Timeline frame count exceeds safe integer range");
  return last;
}
export function frameSceneTime(
  frame: number,
  fps: number,
  sampleIntervalSeconds?: number,
) {
  const step = sampleIntervalSeconds ?? 1 / fps;
  validStep(step);
  if (
    !Number.isSafeInteger(frame) ||
    frame < 0 ||
    !Number.isFinite(frame * step)
  )
    throw new Error("Invalid scene frame");
  return sampleIntervalSeconds === undefined ? frame / fps : frame * step;
}
/** Preserve source times across axis changes, snapping gaps to the nearest kept
 * frame. Frame order is normalized for reverse playback; ties choose the earlier
 * output frame. A full selection is not automatically expanded into restored gaps.
 */
export function remapFrameRange(options: {
  previous: RecordingTimeline;
  next: RecordingTimeline;
  previousStep: number;
  nextStep: number;
  startFrame: number;
  endFrame: number;
}) {
  const { previous, next, previousStep, nextStep, startFrame, endFrame } =
    options;
  validStep(previousStep);
  const last = lastRecordingFrame(next.duration, nextStep);
  if (
    ![startFrame, endFrame].every(
      (frame) => Number.isSafeInteger(frame) && frame >= 0,
    ) ||
    endFrame < startFrame
  )
    throw new Error("Invalid frame range");
  const nearest = (frame: number) => {
    const time = previous.timeAt(frame * previousStep);
    const position = next.positionAt(time) / nextStep;
    if (!Number.isFinite(time) || !Number.isFinite(position))
      throw new Error("Timeline mapping must return finite values");
    const candidates = [
      Math.floor(position) - 1,
      Math.floor(position),
      Math.ceil(position),
      Math.ceil(position) + 1,
    ].map((candidate) => Math.max(0, Math.min(last, candidate)));
    const distance = (candidate: number) => {
      const mapped = next.timeAt(candidate * nextStep);
      if (!Number.isFinite(mapped))
        throw new Error("Timeline mapping must return finite values");
      return Math.abs(mapped - time);
    };
    return candidates.reduce((best, candidate) =>
      distance(candidate) < distance(best) ? candidate : best,
    );
  };
  const a = nearest(startFrame),
    b = nearest(endFrame);
  return { startFrame: Math.min(a, b), endFrame: Math.max(a, b) };
}
