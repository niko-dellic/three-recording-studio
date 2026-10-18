import type {
  AnimationAdapter,
  CaptureAdapter,
} from "three-recording-studio/core";

/** Application-owned deterministic replay. The capture surface is independent of React. */
export function createReplay() {
  let time = 0,
    acquired = false;
  let target: OffscreenCanvas | undefined;
  const paint = (
    context: OffscreenCanvasRenderingContext2D,
    width: number,
    height: number,
  ) => {
    context.clearRect(0, 0, width, height);
    context.fillStyle = "#202020";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#67c5bc";
    for (let i = 0; i < 12; i++) {
      const bar =
        height * (0.25 + (0.6 * (Math.sin(time * 3 + i / 2) + 1)) / 2);
      context.fillRect((i * width) / 12 + 3, height - bar, width / 12 - 6, bar);
    }
  };
  const animation: AnimationAdapter = {
    acquire() {
      const snapshot = time;
      acquired = true;
      return snapshot;
    },
    seek(context) {
      time = context.time;
    },
    async ready({ signal }) {
      // Replace this with an abort-aware simulation-data load/evaluation.
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const done = () => {
          signal.removeEventListener("abort", abort);
          resolve();
        };
        const timer = setTimeout(done, 12);
        const abort = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
          reject(signal.reason);
        };
        signal.addEventListener("abort", abort, { once: true });
      });
    },
    restore(snapshot) {
      time = snapshot as number;
      acquired = false;
    },
  };
  const capture: CaptureAdapter = {
    capabilities: () => ({ transparent: false, cameraFit: false }),
    prepare(settings) {
      target = new OffscreenCanvas(settings.width, settings.height);
    },
    async capture({ signal }) {
      signal.throwIfAborted();
      if (!acquired || !target) throw new Error("Replay is not acquired");
      const context = target.getContext("2d")!;
      paint(context, target.width, target.height);
      const image = context.getImageData(0, 0, target.width, target.height);
      return {
        width: target.width,
        height: target.height,
        pixels: new Uint8Array(image.data.buffer),
      };
    },
    finish() {
      target = undefined;
    },
    dispose() {
      target = undefined;
    },
  };
  return { animation, capture };
}
