import { describe, expect, it } from "vitest";
import { RenderController } from "../src/core/controller.js";
import { RenderSession } from "../src/core/session.js";
import type { RenderDestination } from "../src/core/types.js";

function fixture(
  destination: RenderDestination | (() => Promise<RenderDestination>),
) {
  let restored = 0;
  const session = new RenderSession({
    animation: {
      acquire() {},
      seek() {},
      restore() {
        restored++;
      },
    },
    capture: {
      prepare() {},
      async capture() {
        return { width: 2, height: 2, pixels: new Uint8Array(16) };
      },
      finish() {},
      dispose() {},
    },
  });
  const controller = new RenderController({
    session,
    job: {
      id: "test",
      contentId: "scene",
      width: 2,
      height: 2,
      fps: 30,
      startFrame: 0,
      endFrame: 0,
    },
    destination:
      typeof destination === "function" ? destination : () => destination,
  });
  return { session, controller, restored: () => restored };
}
const sink = (): RenderDestination => ({
  async open() {
    return new Set();
  },
  async write() {},
  async close() {},
  async abort() {},
});

describe("shared recording controller", () => {
  it("locks commands while resolving a destination and exposes failures without acquiring the scene", async () => {
    let reject!: (reason: unknown) => void;
    let calls = 0;
    const { controller, session, restored } = fixture(() => {
      calls++;
      return new Promise((_, fail) => {
        reject = fail;
      });
    });
    const run = controller.start();
    expect(controller.busy).toBe(true);
    await controller.start();
    expect(calls).toBe(1);
    reject(new Error("Folder unavailable"));
    await expect(run).rejects.toThrow("Folder unavailable");
    expect(controller.error).toContain("Folder unavailable");
    expect(controller.busy).toBe(false);
    expect(session.status.state).toBe("idle");
    expect(restored()).toBe(0);
  });

  it("disposing the controller disconnects views but does not cancel an active session", async () => {
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const destination = sink();
    destination.write = async () => {
      entered();
      await gate;
    };
    const { controller, session, restored } = fixture(destination);
    let notifications = 0;
    controller.subscribe(() => {
      notifications++;
    });
    const run = controller.start();
    await ready;
    controller.dispose();
    const before = notifications;
    release();
    await run;
    expect(session.status.state).toBe("completed");
    expect(restored()).toBe(1);
    expect(notifications).toBe(before);
    await expect(controller.start()).rejects.toThrow("disposed");
    await session.dispose();
  });

  it("publishes terminal state for a session started outside the controller", async () => {
    const { controller, session } = fixture(sink());
    const busy: boolean[] = [];
    controller.subscribe(() => {
      busy.push(controller.busy);
    });
    await session.start(controller.getJob(), sink());
    expect(busy).toContain(true);
    expect(busy.at(-1)).toBe(false);
  });
});

it("externally owned results survive controller disposal", async () => {
  const { RenderResults } = await import("../src/core/results.js");
  const results = new RenderResults();
  const { session } = fixture(sink());
  const controller = new RenderController({
    session,
    results,
    job: {
      id: "shared",
      contentId: "shared",
      width: 2,
      height: 2,
      fps: 30,
      startFrame: 0,
      endFrame: 0,
    },
    destination: sink,
  });
  const result = controller.addResult({
    blob: new Blob(["png"]),
    filename: "frame.png",
  });
  controller.dispose();
  expect(results.getSnapshot()).toEqual([result]);
  results.dispose();
  await session.dispose();
});
