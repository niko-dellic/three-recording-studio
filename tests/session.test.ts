import { describe, it, expect, vi } from "vitest";
import { RenderSession, validateJob } from "../src/core/session";
import type {
  CaptureAdapter,
  RenderDestination,
  RenderJob,
  AnimationAdapter,
} from "../src/core/types";
const job: RenderJob = {
  id: "test",
  contentId: "scene-v1",
  width: 2,
  height: 2,
  fps: 30,
  startFrame: 0,
  endFrame: 3,
};
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function setup(saved: number[] = []) {
  const events: string[] = [];
  let acquired = false;
  const animation: AnimationAdapter = {
    acquire: () => {
      acquired = true;
      events.push("acquire");
      return 9;
    },
    seek: async (c) => {
      expect(acquired).toBe(true);
      events.push(`seek:${c.frame}:${c.time}`);
    },
    restore: vi.fn((s) => {
      expect(s).toBe(9);
      acquired = false;
      events.push("restore");
    }),
  };
  const capture: CaptureAdapter = {
    prepare: vi.fn(),
    capture: vi.fn(async (c) => {
      events.push(`capture:${c.frame}`);
      await delay(2);
      return { pixels: new Uint8Array(16), width: 2, height: 2 };
    }),
    finish: vi.fn(),
    dispose: vi.fn(),
  };
  const destination: RenderDestination = {
    open: vi.fn(async () => new Set(saved)),
    write: vi.fn(async (_, c) => {
      await delay(3);
      events.push(`saved:${c.frame}`);
    }),
    close: vi.fn(async () => {}),
    abort: vi.fn(async () => {}),
  };
  return {
    session: new RenderSession({ capture, animation }),
    animation,
    capture,
    destination,
    events,
  };
}
describe("RenderSession", () => {
  it("awaits capture and persistence without dropping frames at slow wall-clock speed", async () => {
    const s = setup();
    await s.session.start(job, s.destination);
    expect(s.events).toEqual([
      "acquire",
      ...Array.from({ length: 4 }, (_, f) => [
        `seek:${f}:${f / 30}`,
        `capture:${f}`,
        `saved:${f}`,
      ]).flat(),
      "restore",
    ]);
    expect(s.session.status).toMatchObject({
      state: "completed",
      completed: 4,
      total: 4,
    });
    expect(s.capture.finish).toHaveBeenCalledOnce();
  });
  it("skips durably saved frames and evaluates missing frames by absolute time", async () => {
    const s = setup([0, 2]);
    await s.session.start(job, s.destination);
    expect(s.events.filter((e) => e.startsWith("seek"))).toEqual([
      "seek:1:0.03333333333333333",
      "seek:3:0.1",
    ]);
    expect(s.session.status.completed).toBe(4);
  });
  it("pauses only between frames and resumes", async () => {
    const s = setup();
    s.session.onFrame((_, index) => {
      if (index === 0) s.session.pause();
    });
    const promise = s.session.start(job, s.destination);
    await vi.waitFor(() => expect(s.session.status.state).toBe("paused"));
    expect(s.destination.write).toHaveBeenCalledTimes(1);
    await delay(10);
    expect(s.capture.capture).toHaveBeenCalledTimes(1);
    s.session.resume();
    await promise;
    expect(s.session.status.state).toBe("completed");
  });
  it("cancels a paused job and restores scene state", async () => {
    const s = setup();
    s.session.onFrame(() => s.session.pause());
    const promise = s.session.start(job, s.destination);
    await vi.waitFor(() => expect(s.session.status.state).toBe("paused"));
    s.session.cancel();
    await promise;
    expect(s.session.status.state).toBe("cancelled");
    expect(s.animation.restore).toHaveBeenCalledOnce();
    expect(s.destination.abort).toHaveBeenCalledOnce();
  });
  it("restores after readback failure and can run a new job", async () => {
    const s = setup();
    vi.mocked(s.capture.capture).mockRejectedValueOnce(new Error("GPU lost"));
    await expect(s.session.start(job, s.destination)).rejects.toThrow(
      "GPU lost",
    );
    expect(s.animation.restore).toHaveBeenCalledOnce();
    expect(s.session.status.state).toBe("failed");
    await s.session.start(job, s.destination);
    expect(s.session.status.state).toBe("completed");
  });
  it("restores after destination failure and does not count unacknowledged frames", async () => {
    const s = setup();
    vi.mocked(s.destination.write).mockRejectedValueOnce(
      new Error("Disconnected"),
    );
    await expect(s.session.start(job, s.destination)).rejects.toThrow(
      "Disconnected",
    );
    expect(s.session.status.completed).toBe(0);
    expect(s.animation.restore).toHaveBeenCalledOnce();
  });
  it("rejects concurrent jobs and disposes active work", async () => {
    const s = setup();
    s.session.onFrame(() => s.session.pause());
    const first = s.session.start(job, s.destination);
    await expect(s.session.start(job, s.destination)).rejects.toThrow("busy");
    await s.session.dispose();
    await first;
    expect(s.session.status.state).toBe("disposed");
    expect(s.capture.dispose).toHaveBeenCalledOnce();
  });
  it("validates settings before touching application state", () => {
    expect(() => validateJob({ ...job, width: 0 })).toThrow();
    expect(() => validateJob({ ...job, fps: NaN })).toThrow();
    expect(() => validateJob({ ...job, id: "../escape" })).toThrow();
  });
});

it("allows immediate resume from a paused-state subscriber without deadlocking", async () => {
  const s = setup();
  s.session.onFrame((_, frame) => {
    if (frame === 0) s.session.pause();
  });
  s.session.subscribe((p) => {
    if (p.state === "paused") s.session.resume();
  });
  await s.session.start(job, s.destination);
  expect(s.session.status.state).toBe("completed");
});
it("prevents reentrant starts during the preparing notification", async () => {
  const s = setup();
  let rejected: Promise<unknown> | undefined;
  s.session.subscribe((p) => {
    if (p.state === "preparing")
      rejected = s.session.start(job, s.destination).catch((e) => e.message);
  });
  await s.session.start(job, s.destination);
  expect(await rejected).toContain("busy");
});
it("reports restoration errors even after cancellation", async () => {
  const s = setup();
  s.session.onFrame(() => s.session.cancel());
  s.animation.restore = () => {
    throw new Error("restore error");
  };
  await expect(s.session.start(job, s.destination)).rejects.toThrow(
    "restoration failed",
  );
  expect(s.session.status.state).toBe("failed");
});

it("still preview captures a copied frame and restores application state", async () => {
  const s = setup();
  const result = await s.session.preview(job, 2);
  expect(result).toMatchObject({ width: 2, height: 2 });
  expect(s.events).toEqual([
    "acquire",
    "seek:2:0.06666666666666667",
    "capture:2",
    "restore",
  ]);
  expect(s.animation.restore).toHaveBeenCalledOnce();
});

it("samples scene time independently of output FPS, including resumed frames", async () => {
  const s = setup([2]);
  await s.session.start(
    { ...job, startFrame: 1, sampleIntervalSeconds: 2 },
    s.destination,
  );
  expect(s.events.filter((event) => event.startsWith("seek"))).toEqual([
    "seek:1:2",
    "seek:3:6",
  ]);
  expect(s.capture.capture).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ frame: 1, time: 2, delta: 2 }),
  );
  expect(s.capture.prepare).toHaveBeenCalledWith(
    expect.objectContaining({ fps: 30 }),
  );
});
it("uses fractional scene intervals for previews", async () => {
  const s = setup();
  await s.session.preview({ ...job, sampleIntervalSeconds: 0.5 }, 3);
  expect(s.capture.capture).toHaveBeenCalledWith(
    expect.objectContaining({ frame: 3, time: 1.5, delta: 0.5 }),
  );
});
it.each([0, -1, NaN, Infinity])(
  "rejects invalid scene interval %s before acquiring the scene",
  async (sampleIntervalSeconds) => {
    const s = setup();
    await expect(
      s.session.start({ ...job, sampleIntervalSeconds }, s.destination),
    ).rejects.toThrow("Sample interval");
    expect(s.events).toEqual([]);
  },
);
