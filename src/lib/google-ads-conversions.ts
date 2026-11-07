/**
 * BTB-546: what was sent to Google Ads for an application, shaped for the
 * Acquisition panel. Status and times only: the click id is already shown
 * from `attribution`, and Google's error messages are never stored.
 */
import type { GoogleAdsConversionStatus } from '@/lib/schemas/conversations'
import { formatDateMedium } from '@/lib/formatters'

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : typeof v === 'string' && v ? v : null

const NAMES = new Set(['approved', 'funded'])
const ACTIONS = new Set(['upload', 'retract'])
const STATUSES = new Set(['pending', 'sending', 'sent', 'failed', 'expired', 'cancelled'])

export function shapeGoogleAdsConversions(docs: unknown): GoogleAdsConversionStatus[] {
  if (!Array.isArray(docs)) return []
  const out: GoogleAdsConversionStatus[] = []
  for (const raw of docs) {
    if (!raw || typeof raw !== 'object') continue
    const d = raw as Record<string, unknown>
    if (!NAMES.has(String(d.conversionName)) || !STATUSES.has(String(d.status))) continue
    out.push({
      conversionName: d.conversionName as GoogleAdsConversionStatus['conversionName'],
      action: (ACTIONS.has(String(d.action)) ? d.action : 'upload') as 'upload' | 'retract',
      status: d.status as GoogleAdsConversionStatus['status'],
      statusReason: str(d.statusReason),
      lastErrorCode: str(d.lastErrorCode),
      notBefore: iso(d.notBefore),
      sentAt: iso(d.sentAt),
      validatedAt: iso(d.validatedAt),
    })
  }
  return out
}

const REASONS: Record<string, string> = {
  DECISION_REVISED: 'the decision was revised before it was sent',
  DECISION_RESTORED: 'approved again',
  KILLED: 'the application was stopped before it was sent',
  FRAUD_HOLD: 'the loan was cancelled as a fraud hold before it was sent',
  MOCK_DECISION: 'a mock decision',
  CLICK_WINDOW: 'the click window closed',
  EXPIRED_GCLID: 'Google says the click is too old',
  EXPIRED_EVENT: 'Google says the click is too old',
  CONVERSION_EXPIRED: 'Google says the conversion is too old',
}

/** One line per row, e.g. "Approved: sent 7 Nov 2026, 2:02 pm". */
export function googleAdsConversionLine(row: GoogleAdsConversionStatus): string {
  const name = row.conversionName === 'approved' ? 'Approved' : 'Funded'
  const label = row.action === 'retract' ? `${name} (retraction)` : name
  const reason = row.statusReason ? (REASONS[row.statusReason] ?? row.statusReason) : null
  switch (row.status) {
    case 'sent':
      return `${label}: sent${row.sentAt ? ` ${formatDateMedium(row.sentAt)}` : ''}`
    case 'pending':
    case 'sending':
      if (row.validatedAt) {
        return `${label}: checked by Google ${formatDateMedium(row.validatedAt)}${
          row.lastErrorCode ? `, rejected (${row.lastErrorCode})` : ', accepted'
        }; not sent yet`
      }
      return `${label}: waiting to send${
        row.notBefore ? ` (from ${formatDateMedium(row.notBefore)})` : ''
      }${row.lastErrorCode ? `, last try ${row.lastErrorCode}` : ''}`
    case 'failed':
      return `${label}: not accepted${row.lastErrorCode ? ` (${row.lastErrorCode})` : ''}`
    case 'expired':
      return `${label}: not sent, ${reason ?? 'click window closed'}`
    case 'cancelled':
      return `${label}: not sent, ${reason ?? 'cancelled'}`
  }
}
