import { describe, expect, it } from "vitest";
import { RenderResults } from "../src/core/results.js";
const input = (size: number, channel = "1") => ({
  blob: new Blob([new Uint8Array(size)]),
  filename: "render.png",
  channel,
});

describe("retained recording results", () => {
  it("rejects oversized replacements atomically and counts sequence and thumbnail storage", () => {
    const results = new RenderResults({ maxBytes: 10 });
    const first = results.add(input(4));
    results.add(input(3, "2"));
    const before = results.getSnapshot();
    expect(() => results.add(input(8))).toThrow("memory limit");
    expect(results.getSnapshot()).toBe(before);
    results.setThumbnail(first.id, new Blob(["abc"]));
    expect(results.retainedBytes).toBe(10);
    expect(() => results.setThumbnail(first.id, new Blob(["abcd"]))).toThrow(
      "memory limit",
    );
    results.remove(first.id);
    expect(results.retainedBytes).toBe(3);
    const job = {
      id: "sequence",
      contentId: "test",
      width: 2,
      height: 2,
      fps: 30,
      startFrame: 0,
      endFrame: 0,
    };
    const archive = new Blob(["1234"]);
    const frames = [{ blob: new Blob(["1234"]), filename: "1.png", frame: 0 }];
    expect(() =>
      results.add({
        ...input(0),
        blob: archive,
        sequence: { archive, frames, job },
      }),
    ).toThrow("memory limit");
    results.remove(results.getSnapshot()[0].id);
    const sequence = results.add({
      ...input(0),
      blob: archive,
      sequence: { archive, frames, job },
    });
    frames.pop();
    job.fps = 60;
    expect(sequence.sequence!.frames).toHaveLength(1);
    expect(sequence.sequence!.job.fps).toBe(30);
    expect(results.retainedBytes).toBe(8);
  });

  it("retains the same recording after upload failure and retries independently", async () => {
    const results = new RenderResults();
    const result = results.add(input(4));
    let attempts = 0;
    const received: Blob[] = [];
    const writer = async (value: typeof result) => {
      received.push(value.blob);
      if (++attempts === 1) throw new Error("Offline");
    };
    await expect(results.save(result.id, writer)).rejects.toThrow("Offline");
    expect(results.getSaveState(result.id)).toEqual({
      state: "failed",
      error: "Error: Offline",
    });
    expect(results.getSnapshot()[0]).toBe(result);
    await results.retry(result.id);
    expect(results.getSaveState(result.id).state).toBe("saved");
    expect(received).toEqual([result.blob, result.blob]);
  });

  it("deduplicates concurrent saves and aborts replacement without modifying the new result", async () => {
    const results = new RenderResults();
    const result = results.add(input(4));
    let signal!: AbortSignal;
    let release!: () => void;
    const pending = results.save(result.id, async (_, abort) => {
      signal = abort;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    expect(results.retry(result.id)).toBe(pending);
    await Promise.resolve();
    const replacement = results.add(input(6));
    expect(signal.aborted).toBe(true);
    release();
    await expect(pending).rejects.toThrow("Save cancelled");
    expect(results.getSnapshot()).toEqual([replacement]);
    expect(results.getSaveState(replacement.id).state).toBe("unsaved");
    expect(results.getSaveState(result.id).state).toBe("unsaved");
  });

  it("disposing aborts pending persistence and prevents retaining further results", async () => {
    const results = new RenderResults();
    const result = results.add(input(4));
    const pending = results.save(result.id, async () => {});
    results.dispose();
    await expect(pending).rejects.toThrow("Save cancelled");
    expect(results.getSnapshot()).toEqual([]);
    expect(() => results.add(input(1))).toThrow("disposed");
    await expect(results.retry(result.id)).rejects.toThrow("No previous save");
  });
});
