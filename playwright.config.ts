import { defineConfig, devices } from "@playwright/test";

/**
 * The app opened in a real browser, the way a phone opens it. No model keys
 * are set, so a capture waits in Unsorted: the path that must never lose
 * words. Run with `npm run test:browser`.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Pixel 7"],
    baseURL: "http://127.0.0.1:3100",
    locale: "en-US",
  },
  webServer: {
    /* A fresh hub for every run, so no board carries over between runs. */
    command: "rm -rf .e2e-data && npm run build && SYNC_DATA_DIR=.e2e-data npm run start -- -p 3100 -H 127.0.0.1",
    url: "http://127.0.0.1:3100/app",
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
