// tests/unit/lib/decision-reason.test.ts
import { describe, it, expect } from 'vitest'
import { formatDecisionReason, decisionEvidenceRows } from '@/lib/decisionReason'

describe('formatDecisionReason', () => {
  it('labels the fixed codes', () => {
    expect(formatDecisionReason('BUSINESS_ACCOUNT')).toBe('Business account detected')
    expect(formatDecisionReason('PERSONAL_CHECK_FAILED')).toBe('Personal-account check failed (system)')
    expect(formatDecisionReason('NO_PERSONAL_ACCOUNT')).toBe('No personal account shared')
    expect(formatDecisionReason('CREDIT_ASSESSMENT:FINAL_RULE')).toBe('Final decision rule')
  })

  it('labels the prefixed families', () => {
    expect(formatDecisionReason('CREDIT_ASSESSMENT:SERVICEABILITY')).toBe('Serviceability')
    expect(formatDecisionReason('CREDIT_ASSESSMENT:ACCOUNT_CONDUCT')).toBe('Account conduct')
    expect(formatDecisionReason('CREDIT_ASSESSMENT:IDENTITYRISK_ASSESSMENT')).toBe('Identity risk')
    expect(formatDecisionReason('CREDIT_ASSESSMENT:POST_IDENTITY_RISK_CHECKS')).toBe('Post-IDV checks')
    expect(formatDecisionReason('SYSTEM_FAILURE:account_conduct')).toBe('System failure · account conduct')
    expect(formatDecisionReason('G5_TIMEOUT:serviceability,account_conduct')).toBe(
      'Assessment timed out · serviceability, account conduct',
    )
    expect(formatDecisionReason('REAPPLICATION_BLOCK:ID_VERIFICATION')).toBe('Re-application block')
  })

  it('handles empty suffixes on prefixed families', () => {
    expect(formatDecisionReason('CREDIT_ASSESSMENT:')).toBe('CREDIT_ASSESSMENT:')
    expect(formatDecisionReason('SYSTEM_FAILURE:')).toBe('System failure')
    expect(formatDecisionReason('G5_TIMEOUT:')).toBe('Assessment timed out')
  })

  it('falls back to the raw code and to "reason not recorded"', () => {
    expect(formatDecisionReason('SOMETHING_NEW')).toBe('SOMETHING_NEW')
    expect(formatDecisionReason('CREDIT_ASSESSMENT:NEW_THING')).toBe('NEW_THING')
    expect(formatDecisionReason(null)).toBe('reason not recorded')
    expect(formatDecisionReason('')).toBe('reason not recorded')
  })
})

describe('decisionEvidenceRows', () => {
  it('renders personal-account-check evidence, skipping null names', () => {
    expect(
      decisionEvidenceRows({
        component: 'personal_account_check',
        account_names: ['Business Trans Acct', null, 'Everyday'],
        institutions: ['CBA', null],
        classifier: 'gpt-5.6-luna',
      }),
    ).toEqual([
      { label: 'Accounts', value: 'Business Trans Acct, Everyday' },
      { label: 'Institutions', value: 'CBA' },
      { label: 'Classifier', value: 'gpt-5.6-luna' },
    ])
  })

  it('renders per-account labels from the gate v2 metadata', () => {
    expect(
      decisionEvidenceRows({
        component: 'personal_account_check',
        gate: 'v2',
        accounts: [
          { product: 'ANZ Business Essentials', label: 'business', rule: 'product_name', matched: 'business' },
        ],
      }),
    ).toEqual([{ label: 'Account', value: 'ANZ Business Essentials — business (product name)' }])
  })

  it('renders a fail-closed personal check', () => {
    expect(
      decisionEvidenceRows({
        component: 'personal_account_check',
        failure_mode: 'empty_accounts',
        detected_format: 'BASIQ',
      }),
    ).toEqual([
      { label: 'Failure', value: 'empty_accounts' },
      { label: 'Report format', value: 'BASIQ' },
    ])
  })

  it('renders credit-assessment evidence', () => {
    expect(
      decisionEvidenceRows({
        component: 'serviceability',
        reason_code: 'SERVICEABILITY',
        decided_at: '2026-10-19T04:46:12+00:00',
        detail_location: 's3://bucket/serviceability.json',
        declined_components: ['serviceability', 'account_conduct'],
      }),
    ).toEqual([
      { label: 'Failed checks', value: 'serviceability, account conduct' },
      { label: 'Decided', value: '2026-10-19T04:46:12+00:00' },
    ])
  })

  it('renders system-failure and timeout evidence', () => {
    expect(
      decisionEvidenceRows({ component: 'account_conduct', error_type: 'TimeoutError' }),
    ).toEqual([{ label: 'Error', value: 'TimeoutError' }])
    expect(
      decisionEvidenceRows({ component: 'g5_timeout_guard', missing_components: ['serviceability'] }),
    ).toEqual([{ label: 'Missing', value: 'serviceability' }])
  })

  it('returns no rows for null, empty or unknown shapes', () => {
    expect(decisionEvidenceRows(null)).toEqual([])
    expect(decisionEvidenceRows({})).toEqual([])
    expect(decisionEvidenceRows({ component: 'mystery', secret: 'x' })).toEqual([])
  })

  const pac = (accounts: unknown[], extra: Record<string, unknown> = {}) =>
    decisionEvidenceRows({ component: 'personal_account_check', accounts, ...extra })

  it('renders malformed account entries defensively', () => {
    expect(pac([{ product: 'X' }])).toEqual([{ label: 'Account', value: 'X — unlabelled' }])
    expect(pac([{ label: 'business' }])).toEqual([{ label: 'Account', value: '— — business' }])
    expect(pac([{}])).toEqual([])
    expect(pac([null])).toEqual([])
    expect(pac([{ product: 'X', label: 'business', rule: { a: 1 } }])).toEqual([
      { label: 'Account', value: 'X — business' },
    ])
    expect(pac([{ product: 'X', label: 'business', rule: 'holder_entity' }])).toEqual([
      { label: 'Account', value: 'X — business (holder entity)' },
    ])
  })

  it('puts Account rows before the Accounts row', () => {
    expect(
      pac([{ product: 'X', label: 'business' }], { account_names: ['X'] }),
    ).toEqual([
      { label: 'Account', value: 'X — business' },
      { label: 'Accounts', value: 'X' },
    ])
  })
})
