import { defineConfig, devices } from "@playwright/test";

const port = process.env.E2E_PORT ?? "8789";
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "tests",
  // 同じ DB を使うので、1本ずつ順に流す
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // 入っているブラウザを使うとき（Playwright の版と合わないとき）に指定する
        launchOptions: process.env.E2E_CHROMIUM_PATH ? { executablePath: process.env.E2E_CHROMIUM_PATH } : {},
      },
    },
  ],
  webServer: {
    command: "node scripts/serve.mjs",
    url: `${baseURL}/health`,
    reuseExistingServer: !process.env.CI,
    // マイグレーションと wrangler dev の起動を待つ
    timeout: 180_000,
    // wrangler dev の要求ごとのログは、CI でだけ出す（落ちたときに追えるように）
    stdout: process.env.CI ? "pipe" : "ignore",
    stderr: "pipe",
  },
});
