import { test, expect } from '@playwright/test'

// Replace with the seeded multi-account customer used by the existing e2e suite.
// Override via E2E_SERVICING_CUSTOMER_ID env var if your seed uses a different id.
const CUSTOMER_ID = process.env.E2E_SERVICING_CUSTOMER_ID ?? 'B6F9D06B'
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'

test.describe('Servicing cockpit', () => {
  test('shows the three panes and auto-selects an account', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/servicing/${CUSTOMER_ID}`)
    await expect(page.getByTestId('account-rail')).toBeVisible()
    await expect(page.getByTestId('context-pane')).toBeVisible()
    await expect(page.getByTestId('account-summary-bar')).toBeVisible()
  })

  test('keyboard 2 switches to Transactions tab', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/servicing/${CUSTOMER_ID}`)
    await expect(page.getByTestId('account-summary-bar')).toBeVisible()
    await page.keyboard.press('2')
    await expect(page.getByTestId('transactions-tab')).toBeVisible()
  })
})
