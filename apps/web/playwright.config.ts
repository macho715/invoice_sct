import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration — HVDC Invoice Audit Platform
 * plan.md §12 step 9: E2E smoke tests as release gate.
 *
 * - 8 scenarios under apps/web/e2e/invoice-audit.spec.ts
 * - Default: spin up `npm run dev` on port 3000
 * - baseURL: http://localhost:3000 (Next.js dev server)
 * - Set SKIP_WEBSERVER=1 to point at an already-running backend
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: process.env.SKIP_WEBSERVER
    ? undefined
    : {
        command: 'npm run dev',
        port: 3000,
        timeout: 60_000,
        reuseExistingServer: !process.env.CI,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
