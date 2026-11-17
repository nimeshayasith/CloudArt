import { defineConfig } from '@playwright/test'

// Runs against a locally running API (:4000) + Vite dev server (:5173).
// Uses the installed Microsoft Edge so no browser download is needed.
export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  expect: { timeout: 60_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    channel: 'msedge',
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
})
