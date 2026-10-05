/**
 * BTB-404: the dashboard feed's acquisition block against a real Postgres.
 *
 * The unit test stubs the pool, so it cannot tell whether the SQL is valid or
 * whether `conversations.attribution` exists. This runs the real query over
 * processor-style rows.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import type { NextRequest } from 'next/server'
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

import { GET } from '@/app/api/marketing/dashboard-feed/route'

const KEY = 'int-dashboard-key'
const CAMPAIGN = 'btb404-int-campaign'

let payload: Payload

async function insertConversation(
  id: string,
  attribution: Record<string, string> | null,
  finalDecision: string | null,
): Promise<void> {
  const attr = attribution ? `'${JSON.stringify(attribution)}'::jsonb` : 'NULL'
  const decision = finalDecision ? `'${finalDecision}'` : 'NULL'
  await payload.db.drizzle.execute(
    `INSERT INTO conversations
       (conversation_id, application_number, status, started_at, updated_at, created_at, attribution, final_decision)
     VALUES ('${id}', '', 'active', now(), now(), now(), ${attr}, ${decision})
     ON CONFLICT (conversation_id) DO NOTHING`,
  )
}

describe('dashboard feed — acquisition block (real SQL)', () => {
  beforeAll(async () => {
    process.env.MARKETING_DASHBOARD_API_KEY = KEY
    payload = await getPayload({ config })
    const click = { gclid: 'int-click', utm_source: 'google', utm_campaign: CAMPAIGN, utm_term: 'pay advance', matchtype: 'p' }
    await insertConversation('conv-btb404-int-1', click, 'APPROVED')
    await insertConversation('conv-btb404-int-2', click, 'DECLINED')
    await insertConversation('conv-btb404-int-3', click, null)
    // organic conversation: must not appear in the block
    await insertConversation('conv-btb404-int-4', null, 'APPROVED')
  })

  it('groups ad-click conversations by campaign and keyword with outcome counts', async () => {
    const res = await GET(
      new Request('http://x/api/marketing/dashboard-feed', {
        headers: { 'x-api-key': KEY },
      }) as unknown as NextRequest,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { acquisition: Array<Record<string, unknown>> }

    const row = body.acquisition.find((r) => r.utmCampaign === CAMPAIGN)
    expect(row).toEqual({
      utmSource: 'google',
      utmMedium: null,
      utmCampaign: CAMPAIGN,
      utmTerm: 'pay advance',
      matchtype: 'p',
      started: 3,
      decided: 2,
      approved: 1,
    })
    expect(JSON.stringify(body.acquisition)).not.toContain('int-click')
  })
})
