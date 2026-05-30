import { defineConfig, devices } from '@playwright/test';

/**
 * Targets the ovh-cloud-dev deployment of `validate/all-themes`.
 * Override with PLAYWRIGHT_BASE_URL=http://localhost:80 etc.
 *
 * Videos: `video: 'on'` records every test (pass or fail) into test-results/.
 * Each test gets an `.webm` (Playwright's native container; convertible to MP4
 * with `ffmpeg -i in.webm out.mp4` if needed). HTML reporter also embeds them.
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://57.131.32.64';

export default defineConfig({
  testDir: './tests',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results',
  globalSetup: './global-setup.ts',
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1366, height: 768 },
    video: 'on',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 90_000,
    ignoreHTTPSErrors: true,
    storageState: 'storage-state/admin.json',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
