import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  timeout: 60000,
  workers: 1,
  use: {
    channel: "chrome",
    headless: true,
    colorScheme: "dark",
    baseURL: "http://127.0.0.1:5187",
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: "npm run build && npm run dev",
    url: "http://127.0.0.1:5187",
    reuseExistingServer: true,
    timeout: 30000,
  },
  reporter: "list",
});
