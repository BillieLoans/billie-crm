/**
 * One-off interactive login that captures a reusable Playwright session.
 *
 *   BASE_URL=https://demo.crm.billie.loans pnpm e2e:auth
 *
 * Opens a real browser window, waits for you to complete Google SSO by hand,
 * then writes the resulting cookies to playwright/.auth/admin.json. The e2e
 * suites load that file and start already authenticated.
 *
 * Why not automate the Google login itself: Google detects and blocks automated
 * browsers, and any 2FA step is unautomatable by design. Capturing the session
 * once is the supported pattern — it also keeps credentials out of the repo,
 * out of CI config, and out of your shell history.
 *
 * The saved file is a live session. It is gitignored; treat it like a password
 * and re-run this when it expires.
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const AUTH_FILE = process.env.E2E_AUTH_FILE ?? 'playwright/.auth/admin.json'
const SESSION_COOKIE = 'payload-token'
const TIMEOUT_MS = 5 * 60 * 1000

const isAuthenticated = async (context) =>
  (await context.cookies()).some((c) => c.name === SESSION_COOKIE && c.value)

async function main() {
  await mkdir(dirname(AUTH_FILE), { recursive: true })

  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext()
  const page = await context.newPage()

  console.log(`\nOpening ${BASE_URL}/admin/login`)
  console.log('Complete the Google sign-in in the browser window.')
  console.log('This script detects the session automatically — no need to close anything.\n')

  await page.goto(`${BASE_URL}/admin/login`, { waitUntil: 'domcontentloaded' })

  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await isAuthenticated(context)) {
      await context.storageState({ path: AUTH_FILE })
      console.log(`✓ Session saved to ${AUTH_FILE}`)
      console.log('  Re-run this command when it stops working (sessions expire).\n')
      await browser.close()
      return
    }
    await page.waitForTimeout(2000)
  }

  await browser.close()
  console.error(`\n✗ Timed out after ${TIMEOUT_MS / 60000} minutes — no "${SESSION_COOKIE}" cookie.`)
  console.error('  If you did sign in, the cookie name may differ; check the browser devtools.\n')
  process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
