import { test, expect } from "@playwright/test";
for (const backend of ["webgl", "webgpu"] as const) {
  test(`${backend}: exact image orientation, colors, alpha and renderer restoration`, async ({
    page,
  }) => {
    await page.goto(`/demo/?backend=${backend}`);
    await page.waitForFunction(() => !!(window as any).trsDemo);
    for (const transparent of [false, true]) {
      const result = await page.evaluate(
        async ({ backend, transparent }) => {
          const module = await import(
            /* @vite-ignore */ String("/demo/test-harness.ts")
          );
          return module.verifyCapture(backend, transparent);
        },
        { backend, transparent },
      );
      expect(result.top).toEqual([255, 0, 0, 255]);
      expect(result.bottom).toEqual(
        transparent ? [0, 0, 0, 0] : [0, 0, 255, 255],
      );
      expect(result.after).toEqual(result.before);
      expect(result.scissorTest).toBe(true);
    }
    const semi = await page.evaluate(async (backend) => {
      const module = await import(String("/demo/test-harness.ts"));
      return module.verifyCapture(backend, true, 0.5);
    }, backend);
    expect(semi.top[0]).toBeGreaterThanOrEqual(253);
    expect(semi.top[1]).toBe(0);
    expect(semi.top[3]).toBeCloseTo(128, 0);
  });
  test(`${backend}: 4K panoramic render, slow destination, frame order and scene recovery`, async ({
    page,
  }) => {
    await page.goto(`/demo/?backend=${backend}`);
    await page.waitForFunction(() => !!(window as any).trsDemo);
    const result = await page.evaluate(async () => {
      const demo = (window as any).trsDemo;
      const before = demo.renderer
        .getSize(new (await import(String("/demo/test-harness.ts"))).Vector2())
        .toArray();
      const frames: number[] = [];
      const sizes: number[][] = [];
      await demo.session.start(
        {
          id: "wide-test",
          contentId: "v1",
          width: 3840,
          height: 1280,
          fps: 30,
          startFrame: 0,
          endFrame: 2,
          cameraFit: "auto",
        },
        {
          async open() {
            return new Set();
          },
          async write(image: any, context: any) {
            await new Promise((r) => setTimeout(r, 60));
            frames.push(context.frame);
            sizes.push([image.width, image.height, image.pixels.length]);
          },
          async close() {},
          async abort() {},
        },
      );
      return {
        frames,
        sizes,
        before,
        after: demo.renderer
          .getSize(
            new (await import(String("/demo/test-harness.ts"))).Vector2(),
          )
          .toArray(),
        state: demo.session.status.state,
      };
    });
    expect(result.frames).toEqual([0, 1, 2]);
    expect(result.sizes).toEqual(Array(3).fill([3840, 1280, 3840 * 1280 * 4]));
    expect(result.after).toEqual(result.before);
    expect(result.state).toBe("completed");
  });
}
test("MP4 contains all frames at the requested timestamps and dimensions", async ({
  page,
}) => {
  await page.goto("/demo/");
  const result = await page.evaluate(async () => {
    const module = await import(
      /* @vite-ignore */ String("/demo/test-harness.ts")
    );
    return module.verifyMp4();
  });
  expect(result.count).toBe(10);
  expect(result.width).toBe(64);
  expect(result.height).toBe(64);
  expect(result.duration).toBeCloseTo(1, 2);
  expect(result.times).toEqual(Array.from({ length: 10 }, (_, i) => i / 10));
  expect(result.restored).toBe(true);
});
test("panel theme and preview navigation leave camera unchanged", async ({
  page,
}) => {
  await page.goto("/demo/");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  const before = await page.evaluate(() =>
    (window as any).trsDemo.camera.toJSON(),
  );
  await page.getByRole("switch", { name: "Dark mode", exact: true }).click();
  await expect(page.locator("body")).toHaveClass(/light/);
  await page.getByRole("button", { name: "100%", exact: true }).click();
  const zoom = page.locator(".trs-zoom");
  await expect(zoom).toHaveText("100%");
  const viewport = page.locator(".trs-viewport");
  await viewport.focus();
  await page.keyboard.press("+");
  await expect(zoom).toHaveText("120%");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("0");
  const fitZoom = await viewport.evaluate((element) => {
    const canvas = element.querySelector("canvas")!;
    const percent =
      Math.min(
        (element.clientWidth - 32) / canvas.width,
        (element.clientHeight - 32) / canvas.height,
      ) *
      devicePixelRatio *
      100;
    return `${Number(percent.toFixed(1))}%`;
  });
  await expect(zoom).toHaveText(fitZoom);
  await expect(page.getByRole("button", { name: "Float panel" })).toHaveCount(
    0,
  );
  expect(
    await page.evaluate(() => (window as any).trsDemo.camera.toJSON()),
  ).toEqual(before);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: /Render settings/ }).click();
  await expect(
    page.getByRole("button", { name: "Render", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/mobile.png" });
});

test("browser PNG saving survives interruption and resumes verified frames", async ({
  page,
}) => {
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  // @ts-expect-error standalone receiver ESM
  const { createReceiver } = await import("../../bin/receiver.mjs");
  const directory = await mkdtemp(join(tmpdir(), "trs-browser-"));
  const receiver = await createReceiver({
    directory,
    port: 0,
    token: "browser-test-token",
  });
  try {
    await page.goto("/demo/");
    await page.waitForFunction(() => !!(window as any).trsDemo);
    const result = await page.evaluate(async (port) => {
      const { WebSocketDestination } = await import(
        String("/demo/test-harness.ts")
      );
      const { session } = (window as any).trsDemo;
      const job = {
        id: "browser-recovery",
        contentId: "fixed-scene",
        width: 320,
        height: 180,
        fps: 30,
        startFrame: 0,
        endFrame: 3,
      };
      const make = () =>
        new WebSocketDestination({
          url: `ws://127.0.0.1:${port}`,
          token: "browser-test-token",
        });
      const unsubscribe = session.subscribe((p: any) => {
        if (p.state === "rendering" && p.completed === 1) session.cancel();
      });
      await session.start(job, make());
      unsubscribe();
      const cancelled = session.status.state;
      await new Promise((resolve) => setTimeout(resolve, 100));
      const rendered: number[] = [];
      const off = session.onFrame((_: unknown, index: number) =>
        rendered.push(index),
      );
      await session.start(job, make());
      off();
      return { cancelled, rendered, completed: session.status.completed };
    }, receiver.port);
    expect(result).toEqual({
      cancelled: "cancelled",
      rendered: [1, 2, 3],
      completed: 4,
    });
    const manifest = JSON.parse(
      await readFile(
        join(directory, "browser-recovery", "manifest.json"),
        "utf8",
      ),
    );
    expect(manifest.complete).toBe(true);
    expect(Object.keys(manifest.frames)).toHaveLength(4);
  } finally {
    await receiver.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("demo recovery identity is stable across exports and page reloads", async ({
  page,
}) => {
  async function identity() {
    return page.evaluate(async () => {
      const panel = (window as any).trsDemo.panel;
      const job = panel.getJob();
      await panel.options.destination(job);
      return job.contentId;
    });
  }
  await page.goto("/demo/");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  const first = await identity();
  expect(await identity()).toBe(first);
  await page.reload();
  await page.waitForFunction(() => !!(window as any).trsDemo);
  expect(await identity()).toBe(first);
});

test("MP4 memory-limit failures propagate and restore application state", async ({
  page,
}) => {
  await page.goto("/demo/");
  const result = await page.evaluate(async () => {
    const module = await import(String("/demo/test-harness.ts"));
    return module.verifyMp4Limit();
  });
  expect(result.error).toContain("memory limit");
  expect(result.restored).toBe(true);
});

test("demo UI exports a rendered MP4 and restores the Theatre playhead", async ({
  page,
}) => {
  await page.goto("/demo/");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  await page.locator("#scrub").evaluate((element) => {
    (element as HTMLInputElement).value = "2";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  for (const [name, value] of [
    ["width", "320"],
    ["height", "180"],
    ["endFrame", "5"],
  ])
    await page.locator(`.trs-controls [name=${name}]`).fill(value);
  await page.evaluate(() => {
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      if (blob instanceof Blob && blob.type === "video/mp4")
        (window as any).renderedVideo = blob;
      return original(blob);
    };
  });
  let downloads = 0;
  page.on("download", () => downloads++);
  await page.getByRole("button", { name: "Render", exact: true }).click();
  await expect(page.locator(".trs-result-video")).toBeVisible();
  await page
    .locator(".trs-result-video")
    .evaluate(async (video: HTMLVideoElement) => {
      await video.play();
    });
  await expect
    .poll(() =>
      page
        .locator(".trs-result-video")
        .evaluate((video: HTMLVideoElement) => video.currentTime),
    )
    .toBeGreaterThan(0);
  expect(downloads).toBe(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("bunny-01.mp4");
  await expect(page.locator(".trs-status")).toContainText("completed");
  const result = await page.evaluate(async () => {
    const module = await import(String("/demo/test-harness.ts"));
    return module.inspectVideo((window as any).renderedVideo);
  });
  expect(result).toMatchObject({ width: 320, height: 180, count: 6 });
  expect(result.duration).toBeCloseTo(0.2, 2);
  expect(Number(await page.locator("#scrub").inputValue())).toBeCloseTo(2, 1);
});

for (const backend of ["webgl", "webgpu"]) {
  test(`${backend}: clipping removes bunny pixels at the animated cut height`, async ({
    page,
  }) => {
    await page.goto(`/demo/?backend=${backend}`);
    await page.waitForFunction(() => !!(window as any).trsDemo);
    const counts = await page.evaluate(async () => {
      const demo = (window as any).trsDemo;
      const counts: number[] = [];
      await demo.session.start(
        {
          ...demo.panel.getJob(),
          width: 320,
          height: 240,
          fps: 1,
          startFrame: 0,
          endFrame: 3,
        },
        {
          async open() {
            return new Set();
          },
          async write(frame: any) {
            let bright = 0;
            for (let i = 0; i < frame.pixels.length; i += 4)
              if (
                frame.pixels[i] > 200 &&
                frame.pixels[i + 1] > 200 &&
                frame.pixels[i + 2] > 200
              )
                bright++;
            counts.push(bright);
          },
          async close() {},
          async abort() {},
        },
      );
      return counts;
    });
    expect(counts[0]).toBeGreaterThan(1000);
    expect(counts[3]).toBeLessThan(counts[0] * 0.15);
    expect(counts[1]).toBeLessThan(counts[0]);
  });
}

test("compact header, fullscreen, and responsive icon transport", async ({
  page,
}) => {
  await page.goto("/demo/");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  await expect(page.locator(".intro")).toHaveCount(0);
  const scrubber = page.locator(".timeline-scrubber");
  const transport = page.locator(".transport");
  expect(
    Math.abs(
      (await scrubber.boundingBox())!.y - (await transport.boundingBox())!.y,
    ),
  ).toBeLessThan(2);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }).first(),
  ).toBeVisible();
  await page.locator("#play").click();
  await page.getByRole("button", { name: "Enter fullscreen" }).click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  await page.getByRole("button", { name: "Exit fullscreen" }).click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: /Animation/ }).click();
  const scrub = (await scrubber.boundingBox())!;
  expect((await transport.boundingBox())!.y).toBeGreaterThan(
    scrub.y + scrub.height,
  );
  await page.screenshot({ path: "test-results/timeline-mobile.png" });
});

test("still renders replace their channel and preserve other channels without automatic downloads", async ({
  page,
}) => {
  await page.goto("/demo/");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  let downloads = 0;
  page.on("download", () => downloads++);
  for (const [name, value] of [
    ["width", "320"],
    ["height", "180"],
  ])
    await page.locator(`.trs-controls [name=${name}]`).fill(value);
  await page.locator("#scrub").evaluate((element: HTMLInputElement) => {
    element.value = "2";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Render image", exact: true }).click();
  const image = page.locator("img.trs-image");
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((e: HTMLImageElement) => e.naturalWidth))
    .toBe(320);
  const first = await image.getAttribute("src");
  await page.getByLabel("Render channel", { exact: true }).selectOption("new");
  await page.getByRole("button", { name: "Render image", exact: true }).click();
  await expect(image).toBeVisible();
  expect(await image.getAttribute("src")).not.toBe(first);
  await page
    .getByRole("combobox", { name: "Render channel", exact: true })
    .selectOption("1");
  await expect(image).toHaveAttribute("src", first!);
  await page.getByRole("button", { name: "Render image", exact: true }).click();
  await expect(image).toBeVisible();
  await expect(image).not.toHaveAttribute("src", first!);
  const replacement = await image.getAttribute("src");
  await expect(
    page.getByRole("combobox", { name: "Saved render", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Render channel", { exact: true }).selectOption("2");
  await expect(image).toBeVisible();
  await expect(image).not.toHaveAttribute("src", replacement!);
  await page.getByLabel("Render channel", { exact: true }).selectOption("1");
  await expect(image).toHaveAttribute("src", replacement!);
  expect(downloads).toBe(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("bunny-01-frame-60.png");
  await page
    .getByRole("button", { name: "Delete render", exact: true })
    .click();
  await expect(image).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Download", exact: true }),
  ).toBeDisabled();
});

test("PNG folder selection writes sequences and stills into separate directories", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).showDirectoryPicker = async () => {
      if ((window as any).cancelPicker)
        throw new DOMException("Cancelled", "AbortError");
      const root = await navigator.storage.getDirectory();
      const folder = await root.getDirectoryHandle(
        `png-test-${crypto.randomUUID()}`,
        { create: true },
      );
      (window as any).pickedFolder = folder;
      return folder;
    };
  });
  await page.goto("/demo/");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  await page.locator("#format").selectOption("frames");
  await page.locator("#save-target").selectOption("folder");
  await expect(page.locator("#pick-folder")).toBeVisible();
  await expect(page.locator("#receiver-fields")).toBeHidden();
  await page.getByRole("button", { name: "Render", exact: true }).click();
  await expect(page.locator(".trs-status")).toContainText("Choose a folder");
  await page.evaluate(() => {
    (window as any).cancelPicker = true;
  });
  await page.locator("#pick-folder").click();
  await expect(page.locator("#folder-status")).toHaveText("No folder selected");
  await page.evaluate(() => {
    (window as any).cancelPicker = false;
  });
  await page.locator("#pick-folder").click();
  await expect(page.locator("#folder-status")).toContainText("png-test-");
  for (const [name, value] of [
    ["width", "64"],
    ["height", "48"],
    ["endFrame", "1"],
  ])
    await page.locator(`.trs-controls [name=${name}]`).fill(value);
  await page.getByRole("button", { name: "Render", exact: true }).click();
  await expect(page.locator(".trs-status")).toContainText("completed · 2 / 2");
  await page.getByRole("button", { name: "Render image", exact: true }).click();
  await expect(page.locator("img.trs-image")).toBeVisible();
  const result = await page.evaluate(async () => {
    const root = (window as any).pickedFolder;
    const manifests = [];
    const sizes = [];
    for await (const dir of root.values()) {
      manifests.push(
        JSON.parse(
          await (
            await (await dir.getFileHandle("render.json")).getFile()
          ).text(),
        ),
      );
      const prefix = manifests[manifests.length - 1].job.fileName;
      const blob = await (
        await dir.getFileHandle(prefix ? `${prefix}-000000.png` : "000000.png")
      ).getFile();
      const image = await createImageBitmap(blob);
      sizes.push([image.width, image.height]);
      image.close();
    }
    return { manifests, sizes };
  });
  expect(result.manifests).toHaveLength(2);
  expect(result.manifests.map((m) => m.completed.length).sort()).toEqual([
    1, 2,
  ]);
  expect(result.manifests.every((m) => m.state === "completed")).toBe(true);
  expect(result.sizes).toEqual([
    [64, 48],
    [64, 48],
  ]);
  await page.locator("#save-target").selectOption("receiver");
  await expect(page.locator("#receiver-fields")).toBeVisible();
  await expect(page.locator("#folder-fields")).toBeHidden();
});

test("Memory and receiver remain available when folder picker is unsupported", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", { value: undefined });
  });
  await page.goto("/demo/");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  await page.locator("#format").selectOption("frames");
  await expect(page.locator("#save-target")).toHaveValue("memory");
  await expect(
    page.locator('#save-target option[value="folder"]'),
  ).toHaveJSProperty("disabled", true);
  await page.locator("#save-target").selectOption("receiver");
  await expect(page.locator("#receiver-fields")).toBeVisible();
});

for (const preference of ["dark", "light", "auto"]) {
  test(`demo paints ${preference} theme before external assets load`, async ({
    page,
  }) => {
    await page.emulateMedia({
      colorScheme: preference === "dark" ? "light" : "dark",
    });
    await page.addInitScript(
      (value) => localStorage.setItem("vitepress-theme-appearance", value),
      preference,
    );
    await page.route(/\.(?:js|ts|css)(?:\?.*)?$/, (route) => route.abort());
    await page.goto("/demo/", { waitUntil: "domcontentloaded" });
    const color =
      preference === "light" ? "rgb(255, 255, 255)" : "rgb(23, 23, 23)";
    expect(
      await page
        .locator("html")
        .evaluate((e) => getComputedStyle(e).backgroundColor),
    ).toBe(color);
    expect(
      await page
        .locator("body")
        .evaluate((e) => getComputedStyle(e).backgroundColor),
    ).toBe(color);
    expect(await page.evaluate(() => !!(window as any).trsDemo)).toBe(false);
  });
}

for (const backend of ["webgl", "webgpu"]) {
  test(`${backend}: stencil cap fills the cut and clears between exported frames`, async ({
    page,
  }) => {
    await page.goto(`/demo/?backend=${backend}`);
    await page.waitForFunction(() => !!(window as any).trsDemo);
    const counts = await page.evaluate(async () => {
      const demo = (window as any).trsDemo;
      const job = { ...demo.panel.getJob(), width: 320, height: 240 };
      const count = async (frame: number) => {
        const image = await demo.session.preview(job, frame);
        let filled = 0;
        for (let i = 0; i < image.pixels.length; i += 4) {
          const [r, g, b, a] = image.pixels.subarray(i, i + 4);
          if (r > g + 12 && g > b + 12 && a > 200) filled++;
        }
        return filled;
      };
      const full = await count(0);
      const cut = await count(54);
      demo.cap.visible = false;
      const uncapped = await count(54);
      demo.cap.visible = true;
      const restored = await count(54);
      const fullAgain = await count(0);
      return { full, cut, uncapped, restored, fullAgain };
    });
    expect(counts.cut).toBeGreaterThan(200);
    expect(counts.uncapped).toBeLessThan(10);
    expect(counts.full).toBeLessThan(10);
    expect(counts.fullAgain).toBe(counts.full);
    expect(counts.restored).toBe(counts.cut);
  });
}

test("play and pause respond to a click held across animation frames", async ({
  page,
}) => {
  await page.goto("/demo/");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  const start = await page.evaluate(() => ({
    time: (window as any).trsDemo.position,
    height: (window as any).trsDemo.clippingPlane.constant,
  }));
  const clickIcon = async () => {
    const box = (await page.locator("#play").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          let frames = 0;
          const next = () =>
            ++frames === 5 ? resolve() : requestAnimationFrame(next);
          requestAnimationFrame(next);
        }),
    );
    await page.mouse.up();
  };
  await clickIcon();
  await expect
    .poll(() => page.evaluate(() => (window as any).trsDemo.position))
    .toBeGreaterThan(start.time + 0.15);
  expect(
    await page.evaluate(() => (window as any).trsDemo.clippingPlane.constant),
  ).not.toBe(start.height);
  await clickIcon();
  await expect(page.locator("#play")).toHaveAttribute("aria-label", "Play");
  const paused = await page.evaluate(() => (window as any).trsDemo.position);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        const next = () =>
          ++frames === 10 ? resolve() : requestAnimationFrame(next);
        requestAnimationFrame(next);
      }),
  );
  expect(await page.evaluate(() => (window as any).trsDemo.position)).toBe(
    paused,
  );
});

test("customizable Quilt layout preserves popout state and default shortcuts", async ({
  page,
}) => {
  await page.goto("/demo/");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  // The demo dedicates panes (no tab headers). Exercise the supported custom
  // arrangement with tab headers enabled before testing their menu/shortcuts.
  await page.evaluate(() => {
    const workspace = (window as any).trsDemo.workspace;
    const layout = workspace.exportLayout();
    const visit = (node: any) => {
      if (node.kind === "group") delete node.dedicatedPaneId;
      else node.children.forEach(visit);
    };
    visit(layout.root);
    workspace.loadLayout(layout);
  });
  await page.getByRole("button", { name: "100%", exact: true }).click();
  await page
    .getByRole("tab", { name: /Render preview/ })
    .click({ button: "right" });
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: /Open in window/ }).click();
  const popup = await popupPromise;
  await expect(popup.locator(".trs-viewport")).toBeVisible();
  await expect(popup.locator(".trs-zoom")).toHaveText("100%");
  await popup.locator(".trs-viewport").focus();
  await popup.keyboard.press("+");
  await expect(popup.locator(".trs-zoom")).toHaveText("120%");
  await popup.getByRole("button", { name: "Return to layout" }).click();
  await expect(page.locator(".trs-zoom")).toHaveText("120%");
  const tab = page.getByRole("tab", { name: /Render preview/ });
  await tab.hover();
  await tab.focus();
  await page.keyboard.press("`");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).trsDemo.workspace.exportLayout().maximized,
      ),
    )
    .toBe("preview-group");
  await page.keyboard.press("`");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).trsDemo.workspace.exportLayout().maximized,
      ),
    )
    .toBe(null);
  await tab.click({ button: "middle" });
  await expect(tab).toHaveCount(0);
  await page.getByRole("tab", { name: /Secondary camera/ }).hover();
  await page.getByRole("tab", { name: /Secondary camera/ }).focus();
  await page.keyboard.press("r");
  await expect(tab).toBeVisible();
  await tab.hover();
  await tab.focus();
  await page.keyboard.press("t");
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("camera frame follows output aspect and camera selection", async ({
  page,
}) => {
  await page.goto("/demo/");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  await page
    .getByLabel("Output template", { exact: true })
    .selectOption("3840x1280");
  const frame = page.locator(".camera-frame");
  await expect
    .poll(async () => {
      const r = await frame.boundingBox();
      return r ? Math.round((r.width / r.height) * 100) : 0;
    })
    .toBe(300);
  await page.getByLabel("Composition guides").selectOption("thirds");
  await expect(page.locator(".composition path")).toHaveCount(2);
  const safeAreas = page.getByRole("button", {
    name: "Safe areas (90% / 80%)",
    exact: true,
  });
  if ((await safeAreas.getAttribute("aria-pressed")) !== "true")
    await safeAreas.click();
  await expect(page.locator(".safe-areas")).toBeVisible();
  await page
    .getByLabel("Render camera", { exact: true })
    .selectOption({ label: "Side camera" });
  await expect
    .poll(() => page.evaluate(() => (window as any).trsDemo.renderCamera.name))
    .toBe("Side camera");
  await expect(page.locator(".camera-overlay")).toBeVisible();
  await expect(frame).toBeVisible();
  const result = await page.evaluate(async () => {
    const demo = (window as any).trsDemo;
    const job = { ...demo.panel.getJob(), width: 96, height: 32 };
    await demo.session.preview(job);
    return demo.renderCamera.name;
  });
  expect(result).toBe("Side camera");
});

test("viewport navigation persists while paused and scrubbing restores the recording camera", async ({
  page,
}) => {
  await page.goto("/demo/");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  const pose = () =>
    page.evaluate(() => (window as any).trsDemo.camera.position.toArray());
  const initial = await pose();
  const viewport = page
    .locator(".pane-content")
    .filter({ has: page.locator(".camera-overlay") });
  let rect = (await viewport.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    rect.x + rect.width / 2 + 70,
    rect.y + rect.height / 2 + 20,
    { steps: 8 },
  );
  await page.mouse.up();
  const moved = await pose();
  expect(moved).not.toEqual(initial);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 10;
        const tick = () => (--frames ? requestAnimationFrame(tick) : resolve());
        requestAnimationFrame(tick);
      }),
  );
  expect(await pose()).toEqual(moved);
  await page.locator("#scrub").evaluate((element: HTMLInputElement) => {
    element.value = "3";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const keyed = await pose();
  expect(keyed[0]).toBeCloseTo(-initial[0], 2);
  expect(keyed[2]).toBeCloseTo(-initial[2], 2);
  rect = (await page
    .getByRole("tabpanel", { name: "Secondary camera", exact: true })
    .boundingBox())!;
  const observerBefore = await page.evaluate(() =>
    (window as any).trsDemo.orbitCamera.position.toArray(),
  );
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    rect.x + rect.width / 2 + 50,
    rect.y + rect.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  expect(
    await page.evaluate(() =>
      (window as any).trsDemo.orbitCamera.position.toArray(),
    ),
  ).not.toEqual(observerBefore);
  expect(await pose()).toEqual(keyed);
  expect(
    await page.evaluate(
      () => (window as any).trsDemo.cameraHelpers.constructor.name,
    ),
  ).toBe("CameraHelpers");
});

test("keyframes workspace contains Theatre and shares edits with rendering", async ({
  page,
}) => {
  await page.goto("/demo/");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  await expect(page.locator('iframe[title="Keyframe editor"]')).toBeHidden();
  const initial = await page.evaluate(() =>
    (window as any).trsDemo.camera.position.toArray(),
  );
  await page.getByRole("button", { name: "Keyframes", exact: true }).click();
  const editor = page.locator('iframe[title="Keyframe editor"]');
  await expect(editor).toBeVisible();
  const box = (await editor.boundingBox())!;
  const pane = (await page.locator(".keyframes-host").boundingBox())!;
  expect(Math.abs(box.y - pane.y)).toBeLessThan(2);
  expect(Math.abs(box.height - pane.height)).toBeLessThan(2);
  const frame = page
    .frames()
    .find((frame) => frame.url().includes("keyframes.html"))!;
  const timeline = frame.locator(".sc-bOhtcR");
  const before = (await timeline.boundingBox())!;
  expect(
    Math.abs(before.x - (pane.x + Math.floor(pane.width * 0.22))),
  ).toBeLessThan(2);
  expect(Math.abs(before.y - pane.y)).toBeLessThan(2);
  expect(Math.abs(before.width - pane.width * 0.78)).toBeLessThan(2);
  const layers = (await frame.locator(".sc-djVXDX").boundingBox())!;
  expect(layers.x + layers.width).toBeLessThan(before.x);
  expect(layers.y).toBeLessThan(before.y + 60);
  expect(
    Math.abs(before.y + before.height - (pane.y + pane.height)),
  ).toBeLessThan(3);
  await page.mouse.move(before.x + 100, before.y + 10);
  await page.mouse.down();
  await page.mouse.move(before.x + 180, before.y + 60, { steps: 8 });
  await page.mouse.up();
  expect(await timeline.boundingBox()).toEqual(before);
  await expect(
    frame.locator(".sc-bOhtcR > [style*='cursor:'][style*='resize']").first(),
  ).toBeHidden();
  await page.getByRole("switch", { name: "Dark mode" }).click();
  expect(
    await frame
      .locator("html")
      .evaluate((element) => element.classList.contains("light")),
  ).toBe(
    await page
      .locator("html")
      .evaluate((element) => element.classList.contains("light")),
  );

  await page.evaluate(() => {
    const { studio, animatedCamera, sheet } = (window as any).trsDemo
      .animationRuntime;
    sheet.sequence.position = 0;
    studio.transaction(({ set }: any) => set(animatedCamera.props.angle, 1));
  });
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).trsDemo.camera.position.toArray()),
    )
    .not.toEqual(initial);
  await page.getByRole("button", { name: "Rendering", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByLabel("Render camera", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as any).trsDemo.animationRuntime.animatedCamera.value.angle,
    ),
  ).toBeCloseTo(1);
  await page.getByRole("button", { name: "Keyframes", exact: true }).click();
  await expect(editor).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as any).trsDemo.animationRuntime.animatedCamera.value.angle,
    ),
  ).toBeCloseTo(1);
});

test("two live camera views navigate independently and follow scrubbing", async ({
  page,
}) => {
  await page.goto("/demo/");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).trsDemo.viewportSession.getViews().length,
      ),
    )
    .toBe(2);
  const secondary = page.locator(".pane-content").filter({
    has: page.locator(".scene-note", { hasText: "Secondary camera" }),
  });
  const recording = page
    .locator(".pane-content")
    .filter({ has: page.locator(".camera-overlay") });
  const large = (await secondary.boundingBox())!;
  const small = (await recording.boundingBox())!;
  expect(large.height).toBeGreaterThan(small.height);
  const before = await page.evaluate(() => ({
    secondary: (window as any).trsDemo.orbitCamera.position.toArray(),
    recording: (window as any).trsDemo.camera.position.toArray(),
  }));
  await page.mouse.move(large.x + large.width / 2, large.y + large.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    large.x + large.width / 2 + 70,
    large.y + large.height / 2 + 30,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).trsDemo.orbitCamera.position.toArray(),
      ),
    )
    .not.toEqual(before.secondary);
  expect(
    await page.evaluate(() =>
      (window as any).trsDemo.camera.position.toArray(),
    ),
  ).toEqual(before.recording);
  await page
    .getByLabel("Animation time")
    .evaluate((element: HTMLInputElement) => {
      element.value = "3";
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).trsDemo.camera.position.toArray()),
    )
    .not.toEqual(before.recording);
  await page.getByRole("button", { name: "Keyframes", exact: true }).click();
  await expect(recording).toBeVisible();
  await expect(secondary).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).trsDemo.viewportSession.getViews().length,
      ),
    )
    .toBe(2);
});

test("WebGPU preserves the render viewport frame projection", async ({
  page,
}) => {
  await page.goto("/demo/?backend=webgpu");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  const result = await page.evaluate(async () => {
    const demo = (window as any).trsDemo;
    const views = demo.viewportSession.getViews();
    await Promise.all(views.map((view: any) => view.ready));
    const renderer = views[0].surface.renderer;
    const original = renderer.render;
    const captures: any[] = [];
    renderer.render = function (scene: any, camera: any) {
      const before = camera.projectionMatrix.elements.slice();
      const system = camera.coordinateSystem;
      const result = original.call(this, scene, camera);
      captures.push({
        before,
        after: camera.projectionMatrix.elements.slice(),
        system,
        rendererSystem: this.coordinateSystem,
      });
      return result;
    };
    try {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    } finally {
      renderer.render = original;
    }
    return captures;
  });
  expect(result.length).toBeGreaterThanOrEqual(2);
  for (const capture of result) {
    // Both observer and recording views must preserve projection X/Y scaling.
    for (const index of [0, 4, 8, 12, 1, 5, 9, 13]) {
      expect(capture.after[index]).toBeCloseTo(capture.before[index], 10);
    }
  }
});

test("WebGPU portrait PNG captures exclude GPU row padding", async ({
  page,
}) => {
  await page.goto("/demo/?backend=webgpu");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  for (const [width, height] of [
    [720, 1280],
    [1080, 1920],
  ]) {
    await page.locator('input[name="width"]').fill(String(width));
    await page.locator('input[name="height"]').fill(String(height));
    await page
      .getByRole("button", { name: "Render image", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Download", exact: true }),
    ).toBeEnabled({ timeout: 30000 });
    const image = page.getByAltText("Saved render");
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate((element: HTMLImageElement) => [
          element.naturalWidth,
          element.naturalHeight,
        ]),
      )
      .toEqual([width, height]);
    await page
      .getByRole("button", { name: "Delete render", exact: true })
      .click();
  }
});

test("all save targets remain available across formats", async ({ page }) => {
  await page.goto("/demo/");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  for (const format of ["mp4", "frames"]) {
    await page.locator("#format").selectOption(format);
    for (const value of ["memory", "folder", "receiver"]) {
      await page.locator("#save-target").selectOption(value);
      await expect(page.locator("#save-target")).toHaveValue(value);
    }
  }
});

test("sidebar timelapse maps scene sampling separately from output FPS", async ({
  page,
}) => {
  await page.goto("/demo/?backend=webgl");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  const interval = page.getByLabel("Capture interval (scene seconds)");
  await expect(interval).toBeHidden();
  await page
    .getByRole("combobox", { name: "Sampling", exact: true })
    .selectOption("Timelapse");
  await interval.fill("2");
  await expect(page.locator(".trs-sampling-speed")).toContainText("60×");
  let job = await page.evaluate(() => (window as any).trsDemo.panel.getJob());
  expect(job.sampleIntervalSeconds).toBe(2);
  expect(job.fps).toBe(30);
  expect(job).not.toHaveProperty("samplingMode");
  await page.getByLabel("Frames / second", { exact: true }).fill("24");
  await expect(page.locator(".trs-sampling-speed")).toContainText("48×");
  await page
    .getByRole("combobox", { name: "Sampling", exact: true })
    .selectOption("Normal");
  await expect(interval).toBeHidden();
  job = await page.evaluate(() => (window as any).trsDemo.panel.getJob());
  expect(job).not.toHaveProperty("sampleIntervalSeconds");
});

test("PNG memory sequence supports playback, scrubbing and ZIP download", async ({
  page,
}) => {
  await page.goto("/demo/");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  await page.locator("#format").selectOption("frames");
  for (const [name, value] of [
    ["width", "64"],
    ["height", "48"],
    ["endFrame", "1"],
  ])
    await page.locator(`.trs-controls [name=${name}]`).fill(value);
  await page.getByRole("button", { name: "Render", exact: true }).click();
  await expect(page.locator(".trs-status")).toContainText("completed · 2 / 2");
  await expect(
    page.getByRole("button", { name: "Play sequence", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Sequence frame").fill("1");
  await expect(page.locator(".trs-sequence-tools")).toContainText("2 / 2");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const zip = Buffer.concat(chunks);
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  expect(zip.readUInt16LE(zip.length - 12)).toBe(2);
  await page
    .getByRole("button", { name: "Delete render", exact: true })
    .click();
  await expect(page.locator(".trs-sequence-tools")).toBeHidden();
});

test("MP4 folder output saves a finalized file and retains playback", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).showDirectoryPicker = async () => {
      const root = await navigator.storage.getDirectory();
      return ((window as any).pickedFolder = await root.getDirectoryHandle(
        crypto.randomUUID(),
        { create: true },
      ));
    };
  });
  await page.goto("/demo/");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  await page.locator("#save-target").selectOption("folder");
  await page.locator("#pick-folder").click();
  for (const [name, value] of [
    ["width", "64"],
    ["height", "48"],
    ["endFrame", "1"],
  ])
    await page.locator(`.trs-controls [name=${name}]`).fill(value);
  await page.getByRole("button", { name: "Render", exact: true }).click();
  await expect(page.locator(".trs-status")).toContainText("completed · 2 / 2");
  const files = await page.evaluate(async () => {
    const results = [];
    for await (const directory of (window as any).pickedFolder.values()) {
      for await (const handle of directory.values()) {
        const file = await handle.getFile();
        results.push({
          name: file.name,
          size: file.size,
          header: await file.slice(4, 8).text(),
        });
      }
    }
    return results;
  });
  expect(files).toHaveLength(1);
  expect(files[0].name).toMatch(/\.mp4$/);
  expect(files[0].header).toBe("ftyp");
  expect(files[0].size).toBeGreaterThan(100);
  await expect(page.locator("video.trs-result-video")).toBeVisible();
});

test("MP4 receiver output persists a completed movie", async ({ page }) => {
  const { mkdtemp, readFile, readdir, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  // @ts-expect-error standalone receiver ESM
  const { createReceiver } = await import("../../bin/receiver.mjs");
  const directory = await mkdtemp(join(tmpdir(), "trs-mp4-"));
  const receiver = await createReceiver({
    directory,
    port: 0,
    token: "mp4-test-token",
  });
  try {
    await page.goto("/demo/");
    await page.waitForFunction(() => !!(window as any).trsDemo);
    await page.locator("#save-target").selectOption("receiver");
    await page.locator("#receiver-url").fill(`ws://127.0.0.1:${receiver.port}`);
    await page.locator("#receiver-token").fill("mp4-test-token");
    for (const [name, value] of [
      ["width", "64"],
      ["height", "48"],
      ["endFrame", "1"],
    ])
      await page.locator(`.trs-controls [name=${name}]`).fill(value);
    await page.getByRole("button", { name: "Render", exact: true }).click();
    await expect(page.locator(".trs-status")).toContainText(
      "completed · 2 / 2",
    );
    await expect(page.locator("#receiver-status")).toHaveText(
      "Saved. Connection closed.",
    );
    const dirs = await readdir(directory);
    expect(dirs).toHaveLength(1);
    const manifest = JSON.parse(
      await readFile(join(directory, dirs[0], "manifest.json"), "utf8"),
    );
    expect(manifest.complete).toBe(true);
    const mp4 = await readFile(join(directory, dirs[0], manifest.file.file));
    expect(mp4.subarray(4, 8).toString()).toBe("ftyp");
    expect(mp4.length).toBe(manifest.file.size);
    await expect(page.locator("video.trs-result-video")).toBeVisible();
  } finally {
    await receiver.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("saved images and videos pan directly over their content", async ({
  page,
}) => {
  await page.goto("/demo/");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  for (const [name, value] of [
    ["width", "320"],
    ["height", "180"],
    ["endFrame", "5"],
  ])
    await page.locator(`.trs-controls [name=${name}]`).fill(value);
  for (const [action, selector] of [
    ["Render image", "img.trs-image"],
    ["Render", "video.trs-result-video"],
  ]) {
    await page.getByRole("button", { name: action, exact: true }).click();
    const media = page.locator(selector);
    await expect(media).toBeVisible();
    await expect
      .poll(() =>
        media.evaluate((el) =>
          el instanceof HTMLVideoElement
            ? el.videoWidth
            : (el as HTMLImageElement).naturalWidth,
        ),
      )
      .toBe(320);
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    const before = await media.boundingBox();
    expect(before).not.toBeNull();
    await page.mouse.move(
      before!.x + before!.width / 2,
      before!.y + before!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      before!.x + before!.width / 2 + 60,
      before!.y + before!.height / 2 + 35,
      { steps: 6 },
    );
    await page.mouse.up();
    const after = await media.boundingBox();
    expect(after!.x - before!.x).toBeCloseTo(60, 0);
    expect(after!.y - before!.y).toBeCloseTo(35, 0);
  }
  await page
    .getByRole("button", { name: "Fullscreen output", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.fullscreenElement?.classList.contains("trs-viewport"),
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("slider", { name: "Video playback position" }),
  ).toBeVisible();
  await page
    .locator("video.trs-result-video")
    .evaluate(async (video: HTMLVideoElement) => {
      video.loop = true;
      await video.play();
    });
  await page.mouse.move(100, 100);
  await expect(page.locator(".trs-viewport")).toHaveClass(/trs-player-idle/, {
    timeout: 5000,
  });
  await page.mouse.move(130, 110);
  await expect(page.locator(".trs-viewport")).not.toHaveClass(
    /trs-player-idle/,
  );
  await page
    .locator("video.trs-result-video")
    .evaluate((video: HTMLVideoElement) => {
      video.pause();
      video.loop = false;
    });
  await page
    .getByRole("button", { name: "Exit output fullscreen", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement === null))
    .toBe(true);
  await page.getByRole("button", { name: "Play video", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator("video.trs-result-video")
        .evaluate((video: HTMLVideoElement) => video.currentTime),
    )
    .toBeGreaterThan(0);
});

test("video scrubber updates smoothly, finishes at maximum, and responds to hovered Space", async ({
  page,
}) => {
  await page.goto("/demo/");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  for (const [name, value] of [
    ["width", "160"],
    ["height", "90"],
    ["endFrame", "59"],
  ])
    await page.locator(`.trs-controls [name=${name}]`).fill(value);
  await page.getByRole("button", { name: "Render", exact: true }).click();
  const video = page.locator("video.trs-result-video");
  await expect(video).toBeVisible();
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState))
    .toBeGreaterThan(1);
  await page.locator(".trs-viewport").hover({ position: { x: 20, y: 80 } });
  await page.locator(".trs-viewport").focus();
  await page.keyboard.press("Space");
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.paused))
    .toBe(false);
  const changes = await page.evaluate(async () => {
    const scrub = document.querySelector<HTMLInputElement>(
      '[aria-label="Video playback position"]',
    )!;
    const values = new Set<string>();
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const sample = () => {
        values.add(scrub.value);
        if (performance.now() - start > 350) resolve();
        else requestAnimationFrame(sample);
      };
      sample();
    });
    return values.size;
  });
  expect(changes).toBeGreaterThan(5);
  await page.keyboard.press("Space");
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.paused))
    .toBe(true);
  await page.keyboard.press("Space");
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.ended))
    .toBe(true);
  const scrub = page.getByRole("slider", { name: "Video playback position" });
  await expect
    .poll(() =>
      scrub.evaluate(
        (el: HTMLInputElement) => Number(el.value) === Number(el.max),
      ),
    )
    .toBe(true);
  await scrub.evaluate((el: HTMLInputElement) => {
    el.value = "0";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect
    .poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
    .toBe(0);
  await scrub.evaluate((el: HTMLInputElement) => {
    el.value = el.max;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect
    .poll(() =>
      scrub.evaluate(
        (el: HTMLInputElement) => Number(el.value) === Number(el.max),
      ),
    )
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "Play video", exact: true }),
  ).toBeVisible();
});

test("public settings updates reflect in the panel and UI edits publish without DOM integration", async ({
  page,
}) => {
  await page.goto("/demo/?backend=webgl");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  await page.evaluate(() => {
    const panel = (window as any).trsDemo.panel;
    (window as any).settingsChanges = [];
    panel.subscribeSettings(() =>
      (window as any).settingsChanges.push(panel.settings.getSnapshot()),
    );
    panel.updateSettings({
      width: 640,
      height: 480,
      startFrame: 2,
      endFrame: 7,
      sampleIntervalSeconds: 2,
    });
  });
  await expect(page.locator('[name="width"]')).toHaveValue("640");
  await expect(page.locator('[name="height"]')).toHaveValue("480");
  await expect(page.locator('[name="startFrame"]')).toHaveValue("2");
  await expect(page.locator('[name="samplingMode"]')).toHaveValue("Timelapse");
  expect(
    await page.evaluate(() => (window as any).settingsChanges.length),
  ).toBe(1);
  await page.locator('[name="width"]').fill("800");
  expect(
    await page.evaluate(() => (window as any).trsDemo.panel.getJob().width),
  ).toBe(800);
  await page.evaluate(() =>
    (window as any).trsDemo.panel.updateSettings({
      sampleIntervalSeconds: undefined,
    }),
  );
  await expect(page.locator('[name="samplingMode"]')).toHaveValue("Normal");
  expect(
    await page.evaluate(
      () => (window as any).trsDemo.panel.getJob().sampleIntervalSeconds,
    ),
  ).toBeUndefined();
});

test("resolution multiplier affects still pixels once and preserves editable base size", async ({
  page,
}) => {
  await page.goto("/demo/?backend=webgl");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  const result = await page.evaluate(async () => {
    const { panel, session } = (window as any).trsDemo;
    panel.updateSettings({
      width: 32,
      height: 16,
      resolutionMultiplier: 2,
      startFrame: 0,
      endFrame: 0,
    });
    const frame = await session.preview(panel.getJob());
    return {
      actual: [frame.width, frame.height, frame.pixels.byteLength],
      base: panel.settings.getSnapshot(),
    };
  });
  expect(result.actual).toEqual([64, 32, 64 * 32 * 4]);
  expect(result.base).toMatchObject({
    width: 32,
    height: 16,
    resolutionMultiplier: 2,
  });
});

test("independent recording views remount during export and expose custom control slots", async ({
  page,
}) => {
  await page.goto("/demo/?backend=webgl");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  const result = await page.evaluate(async () => {
    const ui = await import(String("/demo/component-harness.ts"));
    const { RenderSession } = await import(
      String("/demo/component-harness.ts")
    );
    const hosts = Array.from({ length: 4 }, () => {
      const element = document.createElement("div");
      element.style.cssText = "width:400px;height:300px";
      document.body.append(element);
      return element;
    });
    let release!: () => void;
    let acquired!: () => void;
    const entered = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let restored = 0,
      writes = 0;
    const session = new RenderSession({
      animation: {
        acquire() {},
        async seek() {
          acquired();
          await gate;
        },
        restore() {
          restored++;
        },
      },
      capture: {
        prepare() {},
        async capture() {
          return { width: 8, height: 4, pixels: new Uint8Array(128) };
        },
        finish() {},
        dispose() {},
      },
    });
    const controller = new ui.RenderController({
      session,
      job: {
        id: "components",
        contentId: "components",
        width: 8,
        height: 4,
        fps: 30,
        startFrame: 0,
        endFrame: 1,
      },
      destination: () => ({
        async open() {
          return new Set();
        },
        async write() {
          writes++;
        },
        async close() {},
        async abort() {},
      }),
    });
    const settings = new ui.RenderSettingsView({
      container: hosts[0],
      controller,
      controls: { cameraFit: false, frameRange: false },
    });
    const custom = document.createElement("button");
    custom.textContent = "Custom range";
    settings.slots.frameRange.append(custom);
    const hiddenControlsAbsent = !settings.element.querySelector(
      '[name="cameraFit"], [name="endFrame"]',
    );
    const slotAttached = custom.isConnected;
    const transport = new ui.RenderTransport({
      container: hosts[1],
      controller,
    });
    const progress = new ui.RenderProgress({ container: hosts[2], controller });
    let preview = new ui.RenderPreview({ container: hosts[3], controller });
    const run = controller.start();
    await entered;
    const disabled = transport.element.querySelector("button")!.disabled;
    preview.dispose();
    const busyAfterDetach = session.busy;
    preview = new ui.RenderPreview({ container: hosts[3], controller });
    release();
    await run;
    const complete = progress.element.textContent!.includes("completed");
    const enabled = !transport.element.querySelector("button")!.disabled;
    const pixelsVisible = !preview.element.querySelector("canvas")!.hidden;
    for (const view of [settings, transport, progress, preview]) view.dispose();
    const stateAfterDispose = session.status.state;
    controller.dispose();
    await session.dispose();
    hosts.forEach((host) => host.remove());
    return {
      hiddenControlsAbsent,
      slotAttached,
      disabled,
      busyAfterDetach,
      complete,
      enabled,
      pixelsVisible,
      stateAfterDispose,
      writes,
      restored,
    };
  });
  expect(result).toEqual({
    hiddenControlsAbsent: true,
    slotAttached: true,
    disabled: true,
    busyAfterDetach: true,
    complete: true,
    enabled: true,
    pixelsVisible: true,
    stateAfterDispose: "completed",
    writes: 2,
    restored: 1,
  });
});

test("completed recordings and thumbnails survive preview remount and upload retry", async ({
  page,
}) => {
  await page.goto("/demo/?backend=webgl");
  await page.waitForFunction(() => !!(window as any).trsDemo);
  await page.evaluate(async () => {
    const { panel } = (window as any).trsDemo;
    panel.updateSettings({ width: 640, height: 360 });
    await panel.renderImage();
  });
  await page.waitForFunction(
    () =>
      !!(window as any).trsDemo.panel.recording.results.getSnapshot()[0]
        ?.thumbnail,
  );
  const result = await page.evaluate(async () => {
    const { RenderPreview } = await import(
      String("/demo/component-harness.ts")
    );
    const { panel, session } = (window as any).trsDemo;
    const results = panel.recording.results;
    const record = results.getSnapshot()[0];
    const thumbnail = await createImageBitmap(record.thumbnail);
    const dimensions = [thumbnail.width, thumbnail.height];
    thumbnail.close();
    const previous = panel.previewElement.querySelector("img").src;
    const host = panel.previewElement.parentElement;
    panel.previewView.dispose();
    const preview = new RenderPreview({
      container: host,
      controller: panel.recording,
    });
    const image = preview.element.querySelector("img");
    await image.decode();
    let attempts = 0;
    await results
      .save(record.id, async () => {
        if (++attempts === 1) throw new Error("Offline");
      })
      .catch(() => {});
    const stateAfterFailure = session.status.state;
    const sameUrlAfterFailure = image.src;
    await results.retry(record.id);
    const output = {
      dimensions,
      retained: results.getSnapshot()[0].id === record.id,
      newUrl: image.src !== previous,
      visible: !image.hidden,
      playbackUnchanged: image.src === sameUrlAfterFailure,
      stateAfterFailure,
      saveState: results.getSaveState(record.id).state,
      attempts,
    };
    preview.dispose();
    return output;
  });
  expect(result).toEqual({
    dimensions: [320, 180],
    retained: true,
    newUrl: true,
    visible: true,
    playbackUnchanged: true,
    stateAfterFailure: "completed",
    saveState: "saved",
    attempts: 2,
  });
});
