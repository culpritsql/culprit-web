import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4387" },
  webServer: [
    {
      command: "node tests/serve.mjs",
      url: "http://127.0.0.1:4387/healthz",
      timeout: 25_000,
    },
    {
      command: "bun demo/serve.ts",
      env: { CULPRIT_DEMO_PORT: "4391" },
      url: "http://127.0.0.1:4391/api/session",
      timeout: 25_000,
    },
  ],
});
