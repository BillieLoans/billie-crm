/**
 * Shape `conversations.identity_resolution` (written by the event processor
 * from the platform's identity events, BTB-392) for the browser.
 *
 * Stored shape (jsonb):
 *   link / merge          { canonical_id, alias_id, link_id, reason, at }
 *   resolver_assessments  { <event id>: { verdict, confidence, factors, mode,
 *                           applied, platform_reason_code, latency_ms, model,
 *                           candidate_id, assessed_at, event_id } }
 *   review_case           { case_id, band, posterior, flags, candidate_ids,
 *                           per_signal_bits, recommendation, disposition,
 *                           related_journeys, opened_at }
 *
 * Everything is ids, codes and scores — the source events carry no PII.
 */

import type { IdentityResolution, ResolverAssessment } from '@/lib/schemas/conversations'

type Raw = Record<string, unknown>

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

function outcome(raw: unknown): IdentityResolution['link'] {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Raw
  return {
    canonicalId: str(o.canonical_id),
    aliasId: str(o.alias_id),
    linkId: str(o.link_id),
    reason: str(o.reason),
    at: str(o.at),
  }
}

function assessment(key: string, raw: unknown): ResolverAssessment | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Raw
  return {
    eventId: str(a.event_id) ?? key,
    assessedAt: str(a.assessed_at),
    candidateId: str(a.candidate_id),
    verdict: str(a.verdict),
    confidence: num(a.confidence),
    factors: strList(a.factors),
    mode: str(a.mode),
    applied: bool(a.applied),
    platformReasonCode: str(a.platform_reason_code),
    latencyMs: num(a.latency_ms),
    model: str(a.model),
  }
}

function reviewCase(raw: unknown): IdentityResolution['reviewCase'] {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Raw
  const bits = c.per_signal_bits
  let perSignalBits: Record<string, number> | null = null
  if (bits && typeof bits === 'object') {
    perSignalBits = {}
    for (const [k, v] of Object.entries(bits as Raw)) {
      const n = num(v)
      if (n !== null) perSignalBits[k] = n
    }
  }
  return {
    caseId: str(c.case_id),
    band: str(c.band),
    posterior: num(c.posterior),
    flags: strList(c.flags),
    candidateIds: strList(c.candidate_ids),
    perSignalBits,
    recommendation: str(c.recommendation),
    disposition: str(c.disposition),
    relatedJourneys: strList(c.related_journeys),
    openedAt: str(c.opened_at),
  }
}

/** Null when nothing has been recorded for the journey. */
export function shapeIdentityResolution(raw: unknown): IdentityResolution | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Raw

  const assessmentsRaw = r.resolver_assessments
  const assessments: ResolverAssessment[] = []
  if (assessmentsRaw && typeof assessmentsRaw === 'object' && !Array.isArray(assessmentsRaw)) {
    for (const [key, value] of Object.entries(assessmentsRaw as Raw)) {
      const a = assessment(key, value)
      if (a) assessments.push(a)
    }
  }
  assessments.sort((a, b) => (a.assessedAt ?? a.eventId).localeCompare(b.assessedAt ?? b.eventId))

  const shaped: IdentityResolution = {
    link: outcome(r.link),
    merge: outcome(r.merge),
    resolverAssessments: assessments,
    reviewCase: reviewCase(r.review_case),
  }
  if (!shaped.link && !shaped.merge && assessments.length === 0 && !shaped.reviewCase) {
    return null
  }
  return shaped
}

/** One-line summary for the assessment panel's collapsed header. */
export function identityResolutionSummary(res: IdentityResolution | null | undefined): string {
  if (!res) return '—'
  if (res.link?.canonicalId) {
    return `Linked to ${res.link.canonicalId}${res.link.reason ? ` · ${res.link.reason}` : ''}`
  }
  if (res.merge?.canonicalId) {
    return `Merged into ${res.merge.canonicalId}`
  }
  const last = res.resolverAssessments[res.resolverAssessments.length - 1]
  if (last) {
    const conf = last.confidence !== null ? ` ${last.confidence.toFixed(2)}` : ''
    return `Resolver: ${last.verdict ?? 'no verdict'}${conf}${last.mode ? ` (${last.mode})` : ''}`
  }
  if (res.reviewCase) {
    return `Review case · ${res.reviewCase.band ?? 'band unknown'}`
  }
  return '—'
}
