import { expect, test } from "@playwright/test";

test("vanilla recipe renders MP4 while preserving the live canvas size", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5188/examples/vanilla/");
  await page.waitForFunction(() => !!(window as any).recipe);
  const size = await page.locator("canvas.live").evaluate((canvas) => ({
    width: (canvas as HTMLCanvasElement).width,
    height: (canvas as HTMLCanvasElement).height,
  }));
  await page.locator('[name="endFrame"]').fill("2");
  await expect(
    page.getByRole("button", { name: "Render", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Render", exact: true }).click();
  await expect(page.locator(".trs-status")).toContainText("completed · 3 / 3");
  await expect(page.locator("video")).toBeVisible();
  expect(
    await page.locator("canvas.live").evaluate((canvas) => ({
      width: (canvas as HTMLCanvasElement).width,
      height: (canvas as HTMLCanvasElement).height,
    })),
  ).toEqual(size);
});

test("React recipe retains results through unmount and retries a real backend save", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5188/examples/react/");
  await page.waitForFunction(() => !!(window as any).recipe);
  await page.getByRole("button", { name: "Render", exact: true }).click();
  await page.getByRole("button", { name: "Hide preview", exact: true }).click();
  await expect(page.locator(".trs-status")).toContainText(
    "completed · 20 / 20",
  );
  await page.getByRole("button", { name: "Show preview", exact: true }).click();
  await expect(
    page.getByRole("slider", { name: "Sequence frame" }),
  ).toBeVisible();
  await page.route(
    "**/api/recordings/**",
    (route) => route.fulfill({ status: 503, body: "Temporary failure" }),
    { times: 1 },
  );
  await page
    .getByRole("button", { name: "Save to backend", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Retry save", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^saved$/ }),
  ).toBeVisible();
  const record = await page.evaluate(() => {
    const result = (window as any).recipe.results.getSnapshot()[0];
    return {
      id: result.id,
      filename: result.filename,
      bytes: result.blob.size,
    };
  });
  const { readFile, rm } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const directory = join("/private/tmp/trs-example-uploads", record.id);
  try {
    const file = await readFile(join(directory, record.filename));
    expect(file.byteLength).toBe(record.bytes);
    expect(file.subarray(0, 2).toString()).toBe("PK");
    // Saving an unchanged result again succeeds without replacing the file.
    await page
      .getByRole("button", { name: "Save to backend", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: /^saved$/ }),
    ).toBeVisible();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
