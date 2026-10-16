import { chromium } from "playwright";
const browser = await chromium.launch({
  channel: "chrome",
  headless: process.env.HEADED !== "1",
});
try {
  const page = await browser.newPage({
    colorScheme: "dark",
    viewport: { width: 1440, height: 1000 },
  });
  page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
  page.on("console", (message) => {
    if (["error", "warn"].includes(message.type()))
      console.log(message.type(), message.text());
  });
  await page.goto(
    `http://127.0.0.1:5187/?backend=${process.env.BACKEND ?? "webgl"}`,
  );
  await page.waitForFunction(
    () => window.trsDemo || !document.querySelector("#fatal").hidden,
    { timeout: 30000 },
  );
  console.log("FATAL", await page.locator("#fatal").textContent());
  console.log("READY", await page.evaluate(() => !!window.trsDemo));
  await page.screenshot({
    path: `../../work/demo-${process.env.BACKEND ?? "webgl"}.png`,
  });
  console.log(
    "GPU",
    await page.evaluate(async () => {
      const adapter = await navigator.gpu?.requestAdapter();
      return adapter
        ? {
            info: {
              vendor: adapter.info?.vendor,
              architecture: adapter.info?.architecture,
              device: adapter.info?.device,
              description: adapter.info?.description,
            },
            isFallbackAdapter: adapter.info?.isFallbackAdapter,
          }
        : null;
    }),
  );
} finally {
  await browser.close();
}
