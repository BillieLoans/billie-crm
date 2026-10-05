/**
 * Shape `conversations.attribution` (written by the event processor from
 * conversation_started, BTB-404) for the browser.
 *
 * Stored shape (jsonb, snake_case): gclid, gbraid, wbraid, utm_source,
 * utm_medium, utm_campaign, utm_content, utm_term, matchtype, captured_at,
 * received_at — every value a short string, any of them absent.
 *
 * The values come from a URL anyone can craft. Render them as text only.
 */

import type { Attribution } from '@/lib/schemas/conversations'

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/** The parameters proper — timestamps alone are not attribution. */
const PARAM_KEYS: Array<keyof Attribution> = [
  'gclid',
  'gbraid',
  'wbraid',
  'utmSource',
  'utmMedium',
  'utmCampaign',
  'utmContent',
  'utmTerm',
  'matchtype',
]

export function shapeAttribution(raw: unknown): Attribution | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const shaped: Attribution = {
    gclid: str(o.gclid),
    gbraid: str(o.gbraid),
    wbraid: str(o.wbraid),
    utmSource: str(o.utm_source),
    utmMedium: str(o.utm_medium),
    utmCampaign: str(o.utm_campaign),
    utmContent: str(o.utm_content),
    utmTerm: str(o.utm_term),
    matchtype: str(o.matchtype),
    capturedAt: str(o.captured_at),
    receivedAt: str(o.received_at),
  }
  return PARAM_KEYS.some((k) => shaped[k] !== null) ? shaped : null
}
