import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// isolated ports and data dir so the suite never touches a running app or real data
const API_PORT = 8600;
const WEB_PORT = 3600;
const DATA = path.resolve(__dirname, ".e2e-data");
const venvPython = path.resolve(__dirname, "../.venv/bin/python");
const python = fs.existsSync(venvPython) ? venvPython : "python";
export const SETUP_KEY = "e2e-setup-key-0123456789";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // tests share one API instance (accounts, rate limits)
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${WEB_PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      // fresh demo knowledge base (offline embeddings, stub LLM) on every run
      command: `rm -rf ${DATA} && ${python} ../scripts/seed_demo_data.py --out ${DATA} && cd ../backend && ${python} -m uvicorn app.main:app --port ${API_PORT}`,
      url: `http://127.0.0.1:${API_PORT}/readyz`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        DATA_DIR: DATA,
        ADMIN_TOKEN: SETUP_KEY,
        CORS_ORIGINS: `http://127.0.0.1:${WEB_PORT}`,
        RATE_LIMIT: "1000/minute",
        LLM_PROVIDER: "stub",
        EMBED_PROVIDER: "hash",
        STORE: "local",
        CACHE_BACKEND: "memory",
        LOG_FORMAT: "text",
        // never inherit a developer's .env: real keys, databases and trace endpoints
        GOOGLE_API_KEY: "",
        LLM_API_KEY: "",
        DATABASE_URL: "",
        REDIS_URL: "",
        OTEL_EXPORTER_OTLP_ENDPOINT: "",
        OTEL_EXPORTER_OTLP_HEADERS: "",
        SECRET_KEY: "",
      },
    },
    {
      command: process.env.CI ? `npm run build && npx next start -p ${WEB_PORT}` : `npx next dev -p ${WEB_PORT}`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      timeout: 240_000,
      reuseExistingServer: false,
      env: { NEXT_PUBLIC_API_URL: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
