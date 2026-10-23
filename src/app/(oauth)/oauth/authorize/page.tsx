/**
 * /oauth/authorize — the sign-in page of the reporting MCP connector's
 * OAuth server (`src/server/reporting/mcp-oauth.ts`).
 *
 * Reached from `/api/oauth/authorize` with the checked request, signed
 * (`?req=`). Sends a signed-out person through the CRM login and back, then
 * asks them to approve the connection. It shows who is asking (a name the
 * app chose, so marked as such), where they will be sent back to, the
 * environment, and what Claude will be able to do with their role. The
 * decision posts to `/api/oauth/authorize`.
 */
import React from 'react'
import { headers as getHeaders } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { hasAnyRole } from '@/lib/access'
import { isReportAuthor } from '@/server/reporting/run-report'
import { appOrigin, openAuthorizationRequest } from '@/server/reporting/mcp-oauth'
import styles from '../../oauth.module.css'

export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

function Problem({ message }: { message: string }) {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.brand}>Billie CRM</p>
        <h1>Claude could not be connected</h1>
        <p>{message}</p>
      </div>
    </main>
  )
}

export default async function AuthorizePage({ searchParams }: { searchParams: SearchParams }) {
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') params.set(name, value)
  }
  const payload = await getPayload({ config: configPromise })
  if (params.get('problem') === 'client') {
    return (
      <Problem message="The app is not registered with the CRM, or asked to send you back to an address it did not register. Go back to Claude and connect again." />
    )
  }
  const sealed = params.get('req')
  const request = openAuthorizationRequest(payload.secret, sealed)
  if (!sealed || !request) {
    return <Problem message="This sign-in link has expired. Go back to Claude and connect again." />
  }

  const { user } = await payload.auth({ headers: await getHeaders() })
  if (!user) {
    redirect(`/admin/login?redirect=${encodeURIComponent(`/oauth/authorize?req=${sealed}`)}`)
  }
  if (!hasAnyRole(user)) {
    return (
      <Problem message="Your CRM role does not include reports, so Claude cannot be connected for you." />
    )
  }

  const author = isReportAuthor(user)
  const back = new URL(request.redirectUri)
  const label = process.env.REPORTS_EMAIL_LABEL?.trim()
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.brand}>
          Billie CRM reporting
          {label ? <span className={styles.badge}>{label}</span> : null}
        </p>
        <h1>Connect {request.clientName} to CRM reporting?</h1>
        <dl className={styles.facts}>
          <dt>Signed in as</dt>
          <dd>{String((user as { email?: string }).email ?? '')}</dd>
          <dt>CRM</dt>
          <dd>{new URL(appOrigin()).host}</dd>
          <dt>App</dt>
          <dd>
            {request.clientName} <span className={styles.muted}>(the name the app gave)</span>
          </dd>
          <dt>Sends you back to</dt>
          <dd>
            <strong>{back.host}</strong>
          </dd>
        </dl>
        {LOOPBACK.has(back.hostname) ? (
          <p className={styles.warning} role="note">
            This sends you back to a program on this computer. Only continue if you have just
            started connecting from Claude Code.
          </p>
        ) : null}
        <h2>Claude will be able to</h2>
        <ul>
          <li>list the reports your role can run, and run them</li>
          {author ? (
            <>
              <li>read the reporting schema and run read-only queries on it (up to 1,000 rows)</li>
              <li>save report drafts, which a supervisor publishes</li>
            </>
          ) : null}
        </ul>
        <p className={styles.muted}>
          Claude sees the results of everything it runs. The connection lasts until it goes unused
          for 30 days or an admin removes it under Reporting, MCP connections.
        </p>
        <form method="post" action="/api/oauth/authorize" className={styles.actions}>
          <input type="hidden" name="request" value={sealed} />
          <button type="submit" name="decision" value="allow" className={styles.primary}>
            Allow
          </button>
          <button type="submit" name="decision" value="deny" className={styles.secondary}>
            Cancel
          </button>
        </form>
      </div>
    </main>
  )
}
