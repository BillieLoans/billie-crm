import { defineConfig, devices } from '@playwright/test'

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
import 'dotenv/config'

/**
 * See https://playwright.dev/docs/test-configuration.
 */
const TARGET_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const TARGET_IS_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(TARGET_URL)

export default defineConfig({
  testDir: './tests/e2e',
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    // baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Only boot a local dev server when the suite is actually pointed at localhost.
  // Previously this was unconditional, so `BASE_URL=https://demo… playwright test`
  // would start `pnpm dev` and block waiting for it instead of running anything.
  ...(TARGET_IS_LOCAL
    ? {
        webServer: {
          command: 'pnpm dev',
          reuseExistingServer: true,
          url: 'http://localhost:3000',
        },
      }
    : {}),
})
