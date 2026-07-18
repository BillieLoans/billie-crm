/**
 * Human-readable labels for the marketing module.
 *
 * The projections store raw marketingService vocabulary — event types like
 * `contact.consent.set.v1`, free-text statuses, snake_case stage keys. Staff
 * should never have to read system vocabulary, so every surface (consent
 * history, audit panel, timeline, feedback queue) renders through this module.
 * Unknown values fall back to a best-effort prettifier rather than the raw
 * string, so new platform events degrade gracefully.
 */

/** IDR posture: unresolved complaints older than this are flagged overdue. */
export const OVERDUE_COMPLAINT_DAYS = 21

export const STAGE_LABELS: Record<string, string> = {
  lead: 'Lead',
  waitlist: 'Waitlist',
  invited: 'Invited',
  applicant: 'Applicant',
  customer: 'Customer',
  former_customer: 'Former customer',
}

export const SOURCE_LABELS: Record<string, string> = {
  meta: 'Meta',
  google: 'Google',
  campus: 'Campus',
  referral: 'Referral',
  social_dm: 'Social DM',
  ai_search: 'AI search',
  word_of_mouth: 'Word of mouth',
  organic: 'Organic',
  other: 'Other',
}

export const LOAN_STATUS_LABELS: Record<string, string> = {
  approved: 'Approved',
  disbursed: 'Disbursed (active)',
  repaid: 'Repaid',
}

export const FEEDBACK_STATUS_LABELS: Record<string, string> = {
  new: 'New',
  acknowledged: 'Acknowledged',
  resolved: 'Resolved',
}

export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return '—'
  return STAGE_LABELS[stage] ?? prettify(stage)
}

export function sourceLabel(source: string | null | undefined): string {
  if (!source) return '—'
  return SOURCE_LABELS[source] ?? prettify(source)
}

export function loanStatusLabel(status: string | null | undefined): string {
  if (!status) return '—'
  return LOAN_STATUS_LABELS[status] ?? prettify(status)
}

/**
 * Known marketingService event types → staff-facing labels. Keys are matched
 * with the `.vN` version suffix stripped, so `contact.consent.set.v2` keeps
 * working when the platform revs the envelope.
 */
const EVENT_LABELS: Record<string, string> = {
  'contact.created': 'Contact created',
  'contact.updated': 'Contact details updated',
  'contact.upserted': 'Contact details recorded',
  'contact.consent.set': 'Marketing consent updated',
  'contact.consent.granted': 'Marketing consent granted',
  'contact.consent.withdrawn': 'Marketing consent withdrawn',
  'contact.waitlist.joined': 'Joined the waitlist',
  'contact.batch.assigned': 'Added to a campaign',
  'contact.invited': 'Invitation sent',
  'contact.linked': 'Linked to a customer',
  'contact.unlinked': 'Customer link removed',
  'contact.merged': 'Duplicate record merged in',
  'contact.erased': 'Personal data erased (privacy request)',
  'contact.review_flag.set': 'Review flag changed',
  'contact.stage.changed': 'Stage changed',
  'interaction.logged': 'Interaction logged',
  'feedback.received': 'Feedback received',
  'feedback.status.changed': 'Feedback status changed',
  'batch.created': 'Campaign created',
  'batch.invitations.triggered': 'Campaign invitations sent',
}

/** Strip a trailing `.v1` / `.v12` version suffix from an event type. */
function stripVersion(eventType: string): string {
  return eventType.replace(/\.v\d+$/, '')
}

/** `some_snake.case.value` → `Some snake case value`. */
function prettify(raw: string): string {
  const words = raw
    .replace(/\.v\d+$/, '')
    .split(/[._]/)
    .filter(Boolean)
    .join(' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Staff-facing label for a raw marketingService event type. */
export function eventTypeLabel(eventType: string | null | undefined): string {
  if (!eventType) return '—'
  return EVENT_LABELS[stripVersion(eventType)] ?? prettify(eventType)
}

// ── Consent detail ──────────────────────────────────────────────────────────

export type ConsentChannel = 'sms' | 'whatsapp' | 'email'
export const CONSENT_CHANNELS: ConsentChannel[] = ['sms', 'whatsapp', 'email']

export const CHANNEL_LABELS: Record<ConsentChannel, string> = {
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  email: 'Email',
}

export interface ConsentSummary {
  /** Overall marketing consent, if the projection records one. */
  granted: boolean | null
  /** Channels covered by the grant, when the projection includes them. */
  channels: ConsentChannel[] | null
  /** How consent was captured (e.g. "campus stall form"), when recorded. */
  method: string | null
}

/**
 * Best-effort read of the consent JSON column: `{ marketing: { granted,
 * channels?, method? } }`. Defensive on purpose — the shape is produced by the
 * Python projection and is not typed on this side.
 */
export function summariseConsent(consent: unknown): ConsentSummary {
  const empty: ConsentSummary = { granted: null, channels: null, method: null }
  if (!consent || typeof consent !== 'object' || Array.isArray(consent)) return empty
  const marketing = (consent as Record<string, unknown>).marketing
  if (!marketing || typeof marketing !== 'object' || Array.isArray(marketing)) return empty

  const m = marketing as Record<string, unknown>
  const granted = typeof m.granted === 'boolean' ? m.granted : null
  const channels = Array.isArray(m.channels)
    ? (m.channels.filter(
        (c): c is ConsentChannel => c === 'sms' || c === 'whatsapp' || c === 'email',
      ) satisfies ConsentChannel[])
    : null
  const method = typeof m.method === 'string' && m.method.trim() ? m.method : null
  return { granted, channels: channels && channels.length > 0 ? channels : null, method }
}

/**
 * One-line human description of a consent audit row, using the event detail
 * JSON when present: "Granted — SMS, WhatsApp · campus stall form".
 */
export function describeConsentAudit(detail: unknown): string | null {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null
  const d = detail as Record<string, unknown>
  const parts: string[] = []
  if (typeof d.granted === 'boolean') parts.push(d.granted ? 'Granted' : 'Withdrawn')
  if (Array.isArray(d.channels) && d.channels.length > 0) {
    const channels = d.channels
      .filter((c): c is ConsentChannel => c === 'sms' || c === 'whatsapp' || c === 'email')
      .map((c) => CHANNEL_LABELS[c])
    if (channels.length > 0) parts.push(channels.join(', '))
  }
  const joined = parts.join(' — ')
  const method = typeof d.method === 'string' && d.method.trim() ? d.method.trim() : null
  if (!joined && !method) return null
  return method ? `${joined || 'Recorded'} · ${method}` : joined
}

// ── Timeline interaction kinds ──────────────────────────────────────────────

export const INTERACTION_KIND_LABELS: Record<string, string> = {
  signup: 'Signup',
  message_out: 'Message sent',
  message_in: 'Message received',
  feedback_prompt: 'Feedback prompt',
  referral: 'Referral',
  stage_change: 'Stage change',
  note: 'Note',
  import: 'Import',
}

export function interactionKindLabel(kind: string | null | undefined): string {
  if (!kind) return 'Event'
  return INTERACTION_KIND_LABELS[kind] ?? prettify(kind)
}

/**
 * Grid-filter keys → staff-facing labels, for rendering a batch's criteria
 * snapshot ("stage: waitlist" → "Stage: Waitlist").
 */
export function describeCriteria(criteria: Record<string, unknown>): Array<{
  label: string
  value: string
}> {
  const KEY_LABELS: Record<string, string> = {
    q: 'Search',
    stage: 'Stage',
    source: 'Source',
    city: 'City',
    batch: 'Campaign',
    needs_review: 'Needs review',
    advisory_council: 'Advisory council',
    loan_status: 'Loan outcome',
  }
  const VALUE_LABELS: Record<string, (v: string) => string> = {
    stage: stageLabel,
    source: sourceLabel,
    loan_status: loanStatusLabel,
  }
  return Object.entries(criteria)
    .filter(([, v]) => v !== undefined && v !== null && String(v) !== '')
    .map(([key, value]) => ({
      label: KEY_LABELS[key] ?? prettify(key),
      value: VALUE_LABELS[key] ? VALUE_LABELS[key](String(value)) : String(value),
    }))
}
