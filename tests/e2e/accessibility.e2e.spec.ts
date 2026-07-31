import { existsSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Automated WCAG 2.2 AA scan of each custom admin view.
 *
 * This is the enforcement arm of docs/ux-standards.md §8 for the defect classes
 * ESLint cannot see: missing dialog semantics, unnamed dialogs, contrast, and
 * focus-order problems.
 *
 * Axe catches roughly a third of WCAG issues — a pass here is a floor, not a
 * conformance claim. Target-size (2.5.8), focus-not-obscured (2.4.11) and
 * hover-reveal (1.4.13) still need the manual checklist in §7.
 *
 * Authentication — two supported paths:
 *
 *   Google SSO (how staff actually sign in). Capture a session once, by hand:
 *     BASE_URL=https://demo.crm.billie.loans pnpm e2e:auth
 *     BASE_URL=https://demo.crm.billie.loans pnpm exec playwright test tests/e2e/accessibility.e2e.spec.ts
 *
 *   Email + password (seeded local/CI admin):
 *     E2E_EMAIL=… E2E_PASSWORD=… pnpm exec playwright test tests/e2e/accessibility.e2e.spec.ts
 *
 * Against localhost, BASE_URL can be omitted and the config boots `pnpm dev`.
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const CUSTOMER_ID = process.env.E2E_SERVICING_CUSTOMER_ID ?? 'B6F9D06B'
const EMAIL = process.env.E2E_EMAIL
const PASSWORD = process.env.E2E_PASSWORD
const AUTH_FILE = process.env.E2E_AUTH_FILE ?? 'playwright/.auth/admin.json'
const HAS_SAVED_SESSION = existsSync(AUTH_FILE)

// A captured Google SSO session, when present, authenticates every context up
// front — nothing here ever drives the Google login screen.
test.use(HAS_SAVED_SESSION ? { storageState: AUTH_FILE } : {})

// wcag22aa pulls in the 2.0/2.1 A+AA rules as well.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/**
 * Payload serves its login screen at 200 on every /admin route, so a scan that
 * merely "loaded the page" will happily audit the login form and report a clean
 * pass for all nine views. Everything below exists to make that impossible.
 */
async function assertNotLoginScreen(page: Page, viewName: string) {
  const passwordFields = await page.locator('input[type="password"]').count()
  expect(
    passwordFields,
    `Landed on the login screen instead of "${viewName}". Set E2E_EMAIL and ` +
      `E2E_PASSWORD, or the scan would audit the login form and report a false pass.`,
  ).toBe(0)
}

async function login(page: Page) {
  if (HAS_SAVED_SESSION || !EMAIL || !PASSWORD) return
  await page.goto(`${BASE_URL}/admin/login`)
  if ((await page.locator('input[type="password"]').count()) === 0) return // already authenticated
  await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL)
  await page.locator('input[type="password"]').first().fill(PASSWORD)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 30_000 })
}

async function scan(page: Page, include?: string) {
  const builder = new AxeBuilder({ page }).withTags(TAGS)
  if (include) builder.include(include)
  const results = await builder.analyze()
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
}

/** Name the rule and first offending selector — a bare count is useless in CI. */
const describeViolations = (violations: Awaited<ReturnType<typeof scan>>) =>
  violations.map((v) => `${v.id} (${v.impact}) — ${v.nodes[0]?.target.join(' ')}\n    ${v.help}`).join('\n  ')

test.beforeEach(async ({ page }) => {
  await login(page)
})

test('a session is available', () => {
  expect(
    HAS_SAVED_SESSION || Boolean(EMAIL && PASSWORD),
    `No authentication configured — every /admin route sits behind Payload auth.\n` +
      `  Google SSO:  BASE_URL=${BASE_URL} pnpm e2e:auth   (logs in once, saves ${AUTH_FILE})\n` +
      `  or password: E2E_EMAIL=… E2E_PASSWORD=…`,
  ).toBe(true)
})

/**
 * Ready selectors are each view's own root test id, verified against a running
 * environment. Do not use `main` — Payload's admin shell only renders a <main>
 * landmark on some views (the dashboard has none), so it is not a reliable
 * readiness signal. That missing landmark is itself logged in ux-standards.md §9.
 */
const VIEWS: Array<{ name: string; path: string; ready: string }> = [
  { name: 'dashboard', path: '/admin/dashboard', ready: '[data-testid="dashboard-view"]' },
  { name: 'servicing', path: `/admin/servicing/${CUSTOMER_ID}`, ready: '[data-testid="account-rail"]' },
  { name: 'accounts browser', path: '/admin/accounts', ready: '[data-testid="accounts-browser-view"]' },
  { name: 'approvals', path: '/admin/approvals', ready: '[data-testid="approvals-view"]' },
  // NOT /admin/collections — Payload reserves /admin/collections/* for built-in
  // database-collection admin routes, and hitting it bare produces a redirect loop.
  // See the note on the `collections` view in payload.config.ts.
  // Heading fallback so this passes against environments deployed before the
  // collections-view test id was added.
  {
    name: 'collections',
    path: '/admin/collections-queue',
    ready: '[data-testid="collections-view"], h1:has-text("Collections Queue")',
  },
  { name: 'exports', path: '/admin/exports', ready: '[data-testid="export-center-view"]' },
  { name: 'investigation', path: '/admin/investigation', ready: '[data-testid="investigation-view"]' },
  { name: 'ecl-config', path: '/admin/ecl-config', ready: '[data-testid="ecl-config-view"]' },
  { name: 'period-close', path: '/admin/period-close', ready: '[data-testid="period-close-view"]' },
]

for (const view of VIEWS) {
  test(`${view.name} has no serious or critical accessibility violations`, async ({ page }) => {
    await page.goto(`${BASE_URL}${view.path}`)
    // Check for the login screen first: it gives a far better message than a
    // 15s selector timeout when the saved session has simply expired.
    await assertNotLoginScreen(page, view.name)
    await page
      .waitForSelector(view.ready, { timeout: 20_000 })
      .catch(() => {
        throw new Error(
          `"${view.name}" never rendered ${view.ready} at ${view.path}.\n` +
            `  Either the view failed to load in this environment, or its root test id changed.`,
        )
      })
    await assertNotLoginScreen(page, view.name)

    const blocking = await scan(page)
    expect(blocking, `axe violations on ${view.name}:\n  ${describeViolations(blocking)}`).toEqual([])
  })
}

test('money-movement modals keep dialog semantics when opened', async ({ page }) => {
  // The six modals in ux-standards.md §8.3 shipped without a dialog role at all.
  // Scanning with one open is the regression guard closest to the defect.
  await page.goto(`${BASE_URL}/admin/servicing/${CUSTOMER_ID}`)
  await page.waitForSelector('[data-testid="account-rail"]', { timeout: 15_000 })
  await assertNotLoginScreen(page, 'servicing')

  const recordPayment = page.getByRole('button', { name: /record payment/i }).first()
  await expect(recordPayment, 'no Record Payment action on the seeded account').toBeVisible()
  await recordPayment.click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect(dialog).toHaveAccessibleName(/record payment/i)

  const blocking = await scan(page, '[role="dialog"]')
  expect(blocking, `axe violations in the dialog:\n  ${describeViolations(blocking)}`).toEqual([])
})
