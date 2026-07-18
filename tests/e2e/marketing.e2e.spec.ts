import { test, expect, Page } from '@playwright/test'

/**
 * Marketing module e2e — drives the contacts grid, campaigns, feedback queue
 * and contact detail against a seeded database.
 *
 * Seed expectations (override credentials via E2E_ADMIN_EMAIL/PASSWORD):
 * - admin user e2e-admin@billie.test / E2Epassw0rd!
 * - contacts: Alice (waitlist, Sydney, consent sms+whatsapp, in batch
 *   e2e-batch-1), Bob (lead, Melbourne, consent declined), Carol (waitlist,
 *   Sydney, needs review, in batch e2e-batch-1)
 * - batch e2e-batch-1 "Campus wave 1"
 * - feedback: 1 overdue complaint (Alice), 1 new suggestion (Bob),
 *   1 resolved praise (Alice)
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

test.describe('Marketing module', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(180_000) // first navigation compiles the page on demand in dev
    await login(page)
  })

  test('contacts grid renders identity cells, stats strip and sub-nav', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/marketing`)

    // Sub-nav tabs
    const subnav = page.getByRole('navigation', { name: 'Marketing sections' })
    await expect(subnav.getByRole('link', { name: 'Contacts' })).toBeVisible({ timeout: 60_000 })
    await expect(subnav.getByRole('link', { name: 'Campaigns' })).toBeVisible()
    await expect(subnav.getByRole('link', { name: /Feedback/ })).toBeVisible()

    // Overview stats strip
    await expect(page.getByTestId('marketing-stats')).toBeVisible()
    await expect(page.getByTestId('marketing-stats')).toContainText('Consented')
    await expect(page.getByTestId('marketing-stats')).toContainText('Open feedback')

    // Identity cell: name + secondary contact details in one column
    await expect(page.getByRole('link', { name: 'Alice' })).toBeVisible()
    await expect(page.getByText('+61400000001 · alice@example.com')).toBeVisible()

    // Review flag badge on Carol's row
    await expect(page.getByText('⚑ Review').first()).toBeVisible()
  })

  test('filters sync to the URL, survive reload, and clear via chips', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/marketing`)
    await expect(page.getByRole('link', { name: 'Alice' })).toBeVisible({ timeout: 60_000 })

    await page.getByLabel('Stage').selectOption('waitlist')
    await expect(page).toHaveURL(/stage=waitlist/)

    // Bob is a lead — filtered out
    await expect(page.getByRole('link', { name: 'Bob' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Alice' })).toBeVisible()

    // Active filter chip appears
    await expect(page.getByRole('button', { name: /Stage: Waitlist/ })).toBeVisible()

    // Reload restores the same view from the URL
    await page.reload()
    await expect(page.getByRole('button', { name: /Stage: Waitlist/ })).toBeVisible({
      timeout: 60_000,
    })
    await expect(page.getByRole('link', { name: 'Bob' })).toHaveCount(0)

    // Clear all resets the grid
    await page.getByRole('button', { name: 'Clear all' }).click()
    await expect(page).not.toHaveURL(/stage=waitlist/)
    await expect(page.getByRole('link', { name: 'Bob' })).toBeVisible()
  })

  test('selecting contacts reveals the bulk-action bar', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/marketing`)
    await expect(page.getByRole('link', { name: 'Alice' })).toBeVisible({ timeout: 60_000 })

    // No permanent assign/invite toolbar
    await expect(page.getByText('Send invitations')).toHaveCount(0)

    await page.getByRole('checkbox', { name: 'Select Alice' }).check()
    await expect(page.getByText('1 selected')).toBeVisible()
    await expect(page.getByLabel('Assign to campaign')).toBeVisible()

    await page.getByRole('button', { name: 'Clear selection' }).click()
    await expect(page.getByText('1 selected')).toHaveCount(0)
  })

  test('campaigns list shows membership and send state; detail shows pre-flight', async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/admin/marketing/campaigns`)

    const row = page.getByRole('link', { name: 'Campus wave 1' })
    await expect(row).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText('Not sent')).toBeVisible()

    await row.click()
    await expect(page.getByRole('heading', { name: 'Campus wave 1' })).toBeVisible({
      timeout: 60_000,
    })

    // Members: Alice (consented) + Carol (flagged)
    await expect(page.getByRole('link', { name: 'Alice' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Carol' })).toBeVisible()

    // Criteria snapshot rendered with humanized labels
    await expect(page.getByText(/Stage: Waitlist/)).toBeVisible()

    // Send pre-flight: 2 members, 1 will receive (Alice), 1 flagged (Carol)
    await page.getByRole('button', { name: 'Send invitations…' }).click()
    await expect(page.getByText('Will receive an invitation')).toBeVisible()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Campaign members')
    await expect(dialog.getByRole('button', { name: /Send to 1 member/ })).toBeVisible()
    await expect(dialog).toContainText('Skipped — flagged for review')

    // Escape closes (shared modal behaviour)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('feedback queue defaults to open items and expands rows in place', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/marketing/feedback`)

    // Open by default: complaint + suggestion visible, resolved praise hidden
    await expect(page.getByText('The repayment reminder SMS arrived at 3am', { exact: false })).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText('Signup was quick.')).toHaveCount(0)

    // Overdue complaint is labelled explicitly
    await expect(page.getByText(/Overdue · \d+d/)).toBeVisible()

    // Row click expands the full body in place
    await page.getByText('It would be great to see my repayment schedule', { exact: false }).click()
    await expect(
      page.getByText('It would be great to see my repayment schedule in the app.'),
    ).toHaveCount(2) // truncated cell + expanded body

    // Resolved tab reveals history
    await page.getByRole('button', { name: 'Resolved', exact: true }).click()
    await expect(page).toHaveURL(/status=resolved/)
    await expect(page.getByText('Signup was quick.')).toBeVisible()
  })

  test('contact detail groups the rail and shows per-channel consent', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/marketing/contacts/e2e-alice`)

    await expect(page.getByRole('heading', { name: 'Alice' })).toBeVisible({ timeout: 60_000 })

    // Grouped right rail
    await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Compliance', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible()

    // Per-channel consent chips in the header (SMS + WhatsApp on, Email off)
    const chips = page.locator('[title="Marketing consent by channel"]')
    await expect(chips).toBeVisible()
    await expect(chips).toContainText('SMS')
    await expect(chips).toContainText('WhatsApp')

    // Timeline filter chips render
    await expect(page.getByRole('button', { name: 'Notes' })).toBeVisible()

    // Log a note — appears without a manual refresh (optimistic entry)
    await page.getByLabel('Note text').fill('E2E test note — checking optimistic timeline')
    await page.getByRole('button', { name: 'Log note' }).click()
    await expect(page.getByText('E2E test note — checking optimistic timeline')).toBeVisible({
      timeout: 5_000,
    })
  })
})
