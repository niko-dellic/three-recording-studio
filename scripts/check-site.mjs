// Adapted from publisher-docs/scripts/check-site.mjs for this site's routes.
import { chromium } from "playwright";
import assert from "node:assert/strict";
const origin = process.env.SITE_URL ?? "http://127.0.0.1:5191";
const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const mode of ["light", "dark"]) {
    const context = await browser.newContext({ colorScheme: mode });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const width of [390, 960, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(origin + "/");
      assert.equal(new URL(page.url()).pathname, "/");
      assert.equal(await page.locator('meta[http-equiv="refresh"]').count(), 0);
      await page.evaluate(
        (mode) => localStorage.setItem("vitepress-theme-appearance", mode),
        mode,
      );
      let home;
      for (const route of ["/", "/guide", "/api"]) {
        await page.goto(origin + route);
        await page.waitForFunction(
          () => document.querySelector("#app")?.__vue_app__,
        );
        await page.evaluate(() => document.fonts.ready);
        assert.equal(
          await page
            .locator("html")
            .evaluate((e) => e.classList.contains("dark")),
          mode === "dark",
        );
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          "horizontal overflow",
        );
        const expected =
          mode === "dark" ? "rgb(23, 23, 23)" : "rgb(255, 255, 255)";
        assert.equal(
          await page
            .locator("body")
            .evaluate((e) => getComputedStyle(e).backgroundColor),
          expected,
        );
        assert.equal(
          await page
            .locator(".VPNavBar > .divider")
            .evaluate((e) => getComputedStyle(e).display),
          "none",
        );
        assert.equal(
          (await page.locator(".VPNavBar").boundingBox()).height,
          64,
        );
        if (width >= 960) {
          const sidebar = page.locator(".VPSidebar");
          if (await sidebar.count()) {
            assert.equal(
              await sidebar.evaluate(
                (e) => getComputedStyle(e).backgroundColor,
              ),
              expected,
            );
            assert((await sidebar.boundingBox()).y >= 64);
          }
        }
        const title = await page.locator(".VPNavBarTitle").boundingBox();
        if (!home) home = title;
        else assert(Math.abs(title.x - home.x) < 1, "navbar title shifts");
        if (width === 1440)
          await page.screenshot({
            path: `../../work/docs-${mode}-${route.split("/").at(-1) || "home"}.png`,
          });
      }
      if (width === 390) {
        await page.getByRole("button", { name: /mobile navigation/i }).click();
        await page.locator(".VPNavScreen [role=switch]").click();
        await page.getByRole("button", { name: /mobile navigation/i }).click();
      }
      if (width === 1440) {
        const before = await page.locator("html").getAttribute("class");
        await page.locator(".VPNavBar [role=switch]:visible").click();
        await page.reload();
        await page.waitForFunction(
          () => document.querySelector("#app")?.__vue_app__,
        );
        assert.notEqual(
          await page.locator("html").getAttribute("class"),
          before,
        );
        await page
          .getByRole("button", { name: /Search/ })
          .first()
          .click();
        await page.locator("#localsearch-input").fill("recovery");
        await page.locator(".VPLocalSearchBox .result").first().waitFor();
        await page.keyboard.press("Escape");
      }
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto(origin + "/");
  await page.getByRole("link", { name: /Open the demo/ }).click();
  await page.waitForURL(/\/demo\/?$/);
  await page.waitForFunction(() => !!window.trsDemo);
  await page.screenshot({ path: "../../work/demo-built.png" });
  await page.getByRole("link", { name: "Guide", exact: true }).click();
  await page.waitForURL("**/guide");
  await page.getByRole("link", { name: "Demo", exact: true }).first().click();
  await page.waitForURL(/\/demo\/?$/);
  await page.waitForFunction(() => !!window.trsDemo);
  console.log(
    "Static demo, docs navigation, light/dark, mobile, search, and publisher styling checks passed.",
  );
} finally {
  await browser.close();
}
