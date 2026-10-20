// src/lib/decisionReason.ts
/**
 * Decline-reason helpers (BTB-462).
 *
 * `final_credit_decision.reason` is one of a small set of fixed codes or a
 * prefixed family (`CREDIT_ASSESSMENT:*`, `SYSTEM_FAILURE:*`, `G5_TIMEOUT:*`,
 * `REAPPLICATION_BLOCK:*`). Block-declines keep their own rich rendering
 * (see DecisionBanner / reapplicationBlock.ts); this module labels everything
 * and turns `decision_metadata` into staff-readable rows.
 *
 * Evidence rows are an allow-list keyed by `component`. Never dump unknown
 * keys: the metadata contract forbids PII, but a renderer that printed
 * arbitrary fields would make a future producer slip visible to staff.
 */

const FIXED_LABELS: Record<string, string> = {
  BUSINESS_ACCOUNT: 'Business account detected',
  PERSONAL_CHECK_FAILED: 'Personal-account check failed (system)',
  NO_PERSONAL_ACCOUNT: 'No personal account shared',
  'CREDIT_ASSESSMENT:FINAL_RULE': 'Final decision rule',
}

const COMPONENT_LABELS: Record<string, string> = {
  SERVICEABILITY: 'Serviceability',
  ACCOUNT_CONDUCT: 'Account conduct',
  IDENTITYRISK_ASSESSMENT: 'Identity risk',
  POST_IDENTITY_RISK_CHECKS: 'Post-IDV checks',
}

export const REASON_NOT_RECORDED = 'reason not recorded'

function humaniseComponent(name: string): string {
  return name.replace(/_/g, ' ')
}

export function formatDecisionReason(code: string | null | undefined): string {
  if (!code) return REASON_NOT_RECORDED
  if (FIXED_LABELS[code]) return FIXED_LABELS[code]
  if (code.startsWith('REAPPLICATION_BLOCK:')) return 'Re-application block'
  if (code.startsWith('CREDIT_ASSESSMENT:')) {
    const key = code.slice('CREDIT_ASSESSMENT:'.length)
    return COMPONENT_LABELS[key] ?? key
  }
  if (code.startsWith('SYSTEM_FAILURE:')) {
    return `System failure · ${humaniseComponent(code.slice('SYSTEM_FAILURE:'.length))}`
  }
  if (code.startsWith('G5_TIMEOUT:')) {
    const parts = code
      .slice('G5_TIMEOUT:'.length)
      .split(',')
      .filter(Boolean)
      .map(humaniseComponent)
    return `Assessment timed out · ${parts.join(', ')}`
  }
  return code
}

export interface EvidenceRow {
  label: string
  value: string
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : []
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function decisionEvidenceRows(
  metadata: Record<string, unknown> | null | undefined,
): EvidenceRow[] {
  if (!metadata) return []
  const rows: EvidenceRow[] = []
  const push = (label: string, value: string | null) => {
    if (value) rows.push({ label, value })
  }

  const component = str(metadata.component)
  if (component === 'personal_account_check') {
    const names = strings(metadata.account_names)
    const institutions = strings(metadata.institutions)
    // Gate v2: one row per labelled account (BTB-498); skip non-object entries.
    if (Array.isArray(metadata.accounts)) {
      for (const a of metadata.accounts) {
        if (!a || typeof a !== 'object') continue
        const acc = a as Record<string, unknown>
        push(
          'Account',
          `${acc.product ?? '—'} — ${acc.label}${acc.rule ? ` (${String(acc.rule).replace(/_/g, ' ')})` : ''}`,
        )
      }
    }
    push('Accounts', names.length ? names.join(', ') : null)
    push('Institutions', institutions.length ? institutions.join(', ') : null)
    push('Classifier', str(metadata.classifier))
    push('Failure', str(metadata.failure_mode))
    push('Report format', str(metadata.detected_format))
    push('Error', str(metadata.error_type))
    return rows
  }

  if (component === 'g5_timeout_guard') {
    const missing = strings(metadata.missing_components).map(humaniseComponent)
    push('Missing', missing.length ? missing.join(', ') : null)
    return rows
  }

  if (component === 'final_decision_rule') {
    const decisions = metadata.component_decisions
    if (decisions && typeof decisions === 'object') {
      const pairs = Object.entries(decisions as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'string')
        .map(([k, v]) => `${humaniseComponent(k)}: ${String(v).toLowerCase()}`)
      push('Component results', pairs.length ? pairs.join(' · ') : null)
    }
    return rows
  }

  if (component) {
    // CREDIT_ASSESSMENT:* and SYSTEM_FAILURE:* share the component-keyed shape.
    const failed = strings(metadata.declined_components).map(humaniseComponent)
    push('Failed checks', failed.length ? failed.join(', ') : null)
    push('Decided', str(metadata.decided_at))
    push('Error', str(metadata.error_type))
    return rows
  }

  return rows
}
