import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  use: {
    baseURL: "https://127.0.0.1:3000",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    extraHTTPHeaders: {
      "X-Auth-Proxy-Secret": "e2e-proxy-proof-at-least-32-characters",
      "X-Auth-Request-User": "browser-editor",
      "X-Auth-Request-Groups": "editors",
    },
  },
  webServer: {
    command: "node tests/e2e/server.mjs",
    url: "https://127.0.0.1:3000/healthz",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
  },
});
