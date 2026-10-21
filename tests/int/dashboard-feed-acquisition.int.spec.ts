/**
 * BTB-404 / BTB-500: the dashboard feed's acquisition and channel blocks
 * against a real Postgres.
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
  const decision = finalDecision === null ? 'NULL' : `'${finalDecision}'`
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
    const click = {
      gclid: 'int-click',
      utm_source: 'google',
      utm_campaign: CAMPAIGN,
      utm_term: 'pay advance',
      matchtype: 'p',
    }
    await insertConversation('conv-btb404-int-1', click, 'APPROVED')
    await insertConversation('conv-btb404-int-2', click, 'DECLINED')
    await insertConversation('conv-btb404-int-3', click, null)
    // a final-decision event with no decision is stored as '' — not a decision
    await insertConversation('conv-btb404-int-5', click, '')
    // auto-tagged click: a click id and nothing else
    await insertConversation('conv-btb404-int-6', { gclid: 'int-autotag' }, null)
    // untracked conversation: must not appear in the block, counts as direct
    await insertConversation('conv-btb404-int-4', null, 'APPROVED')
    // BTB-500: inferred from the referrer — source and medium, no click id
    const organic = { utm_source: 'google', utm_medium: 'organic', utm_content: '/' }
    await insertConversation('conv-btb500-int-1', organic, 'APPROVED')
    await insertConversation('conv-btb500-int-2', organic, null)
    await insertConversation(
      'conv-btb500-int-3',
      { utm_source: 'chatgpt', utm_medium: 'llm' },
      'DECLINED',
    )
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
      channel: 'paid',
      utmSource: 'google',
      utmMedium: null,
      utmCampaign: CAMPAIGN,
      utmTerm: 'pay advance',
      matchtype: 'p',
      started: 4,
      decided: 2,
      approved: 1,
    })
    expect(JSON.stringify(body.acquisition)).not.toContain('int-click')

    // click-id-only traffic stays visible as a row with no campaign or keyword
    const untagged = body.acquisition.find(
      (r) => r.utmSource === null && r.utmCampaign === null && r.utmTerm === null,
    )
    expect(untagged).toBeDefined()
    expect(Number(untagged?.started)).toBeGreaterThanOrEqual(1)
  })

  it('reports inferred sources as their own rows and classifies every conversation by channel (BTB-500)', async () => {
    const res = await GET(
      new Request('http://x/api/marketing/dashboard-feed', {
        headers: { 'x-api-key': KEY },
      }) as unknown as NextRequest,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      acquisition: Array<Record<string, unknown>>
      channels: Array<Record<string, unknown>>
    }

    expect(body.acquisition.find((r) => r.utmSource === 'chatgpt')).toEqual({
      channel: 'llm',
      utmSource: 'chatgpt',
      utmMedium: 'llm',
      utmCampaign: null,
      utmTerm: null,
      matchtype: null,
      started: 1,
      decided: 1,
      approved: 0,
    })

    const organic = body.channels.find((r) => r.channel === 'organic')
    expect(organic).toEqual({
      channel: 'organic',
      utmSource: 'google',
      utmMedium: 'organic',
      started: 2,
      decided: 1,
      approved: 1,
    })
    expect(body.channels.find((r) => r.channel === 'llm')).toMatchObject({
      utmSource: 'chatgpt',
      utmMedium: 'llm',
      started: 1,
    })
    // the ad-click rows are paid even without a utm_medium
    expect(
      body.channels.find((r) => r.channel === 'paid' && r.utmSource === 'google'),
    ).toMatchObject({
      utmMedium: null,
      started: 4,
      approved: 1,
    })
    // conversations with no attribution are direct, never dropped
    const direct = body.channels.find((r) => r.channel === 'direct')
    expect(direct).toMatchObject({ utmSource: null, utmMedium: null })
    expect(Number(direct?.started)).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(body.channels)).not.toContain('int-click')
  })
})
