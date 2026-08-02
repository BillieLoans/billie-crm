import { test, expect, Page } from '@playwright/test'

/**
 * Releases e2e — walks the batch-applicant-release flow (define → preflight)
 * against a running app with the release-specific API responses stubbed via
 * `page.route`. This keeps the spec independent of live Redis/billieChat and
 * the projection lag those events would otherwise incur; only the login
 * flow and the marketing overview badge (a plain read-only projection read)
 * hit the real server.
 *
 * Login/bootstrap copied verbatim from tests/e2e/marketing.e2e.spec.ts —
 * same seeded admin user (see tests/e2e/seed-marketing.ts).
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'e2e-admin@billie.test'
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'E2Epassw0rd!'

async function login(page: Page) {
  const res = await page.request.post(`${BASE_URL}/api/users/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    // The CSRF middleware rejects mutations without a same-origin marker.
    headers: { Origin: BASE_URL },
  })
  expect(res.ok()).toBeTruthy()
}

test.describe('Releases module', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(180_000) // first navigation compiles the page on demand in dev
    await login(page)
  })

  test('marketing staff can walk the release flow to the preflight confirm', async ({ page }) => {
    await page.route('**/api/marketing/releases/gate-status', (route) =>
      route.fulfill({ json: { mode: 'gated', setBy: 'ops', changedAt: null } }),
    )
    await page.route('**/api/marketing/releases?page=1', (route) =>
      route.fulfill({
        json: {
          docs: [],
          totalDocs: 0,
          totalPages: 1,
          page: 1,
          hasNextPage: false,
          hasPrevPage: false,
        },
      }),
    )
    await page.route('**/api/marketing/releases/preflight', (route) =>
      route.fulfill({
        json: {
          counts: {
            granted_sms: 131,
            granted_no_sms: 9,
            skipped_already_customer: 6,
            skipped_already_released: 3,
            skipped_needs_review: 1,
            skipped_invalid_number: 0,
          },
          total: 150,
        },
      }),
    )

    await page.goto(`${BASE_URL}/admin/marketing/releases`)
    await expect(page.getByRole('link', { name: 'Releases' })).toBeVisible({ timeout: 60_000 })

    await page.getByRole('button', { name: '+ New release' }).click()
    // Scope to the dialog: the admin header's "Account" link also matches
    // getByLabel('Count') under Playwright's substring/case-insensitive
    // label matching ("Account" contains "count").
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Name').fill('August wave 3')
    await dialog.getByLabel('Count').fill('150')
    await dialog.getByRole('button', { name: /continue/i }).click()

    await expect(dialog.getByText('131')).toBeVisible()
    // The step-2 paragraph and the confirm button both used to read "Release
    // N grants" (Task 8 wording collision); the paragraph was reworded to
    // "Ready to publish N grants?" so this regex only matches the button —
    // scope to the button role rather than getByText to keep it that way.
    await expect(dialog.getByRole('button', { name: /release 140 grants/i })).toBeVisible()
  })
})
