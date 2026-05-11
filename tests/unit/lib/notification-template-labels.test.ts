import { describe, it, expect } from 'vitest'
import {
  TEMPLATE_META,
  getTemplateLabel,
  getFailureLabel,
  isLegallyImportant,
  FAILURE_DISPLAY,
} from '@/lib/notifications/templateLabels'

describe('TEMPLATE_META coverage', () => {
  // Per spec v2 §1e — these template names MUST be present.
  const requiredTemplates = [
    'pre_due_email_first',
    'pre_due_email_first_fallback_sms',
    'pre_due_sms_second',
    'pre_due_sms_second_fallback_email',
    'overdue_email_v1',
    'overdue_sms_v1',
    'overdue_email_v2',
    'overdue_sms_v2',
    'overdue_email_final',
    'statement_monthly_email',
  ]

  it.each(requiredTemplates)('has metadata for %s', (templateName) => {
    expect(TEMPLATE_META[templateName]).toBeDefined()
    expect(TEMPLATE_META[templateName].label).toBeTruthy()
    expect(TEMPLATE_META[templateName].channel).toMatch(/^(email|sms)$/)
  })

  it('marks final overdue as legally important', () => {
    expect(TEMPLATE_META.overdue_email_final.legallyImportant).toBe(true)
  })
})

describe('getTemplateLabel', () => {
  it('returns the friendly label when the template is known', () => {
    expect(getTemplateLabel('pre_due_email_first')).toBe('First pre-due reminder')
  })

  it('falls back to tags.reason + tags.step when template is unknown', () => {
    expect(getTemplateLabel('unknown_template', { reason: 'pre_due', step: 0 })).toBe(
      'Pre Due — step 0',
    )
  })

  it('falls back to the raw template name when nothing else matches', () => {
    expect(getTemplateLabel('mystery_template_v3', null)).toBe('mystery_template_v3')
  })

  it('returns "Notification" when everything is null', () => {
    expect(getTemplateLabel(null, null)).toBe('Notification')
  })
})

describe('getFailureLabel', () => {
  it('returns the human label for each error_type in the spec', () => {
    for (const errorType of Object.keys(FAILURE_DISPLAY)) {
      expect(getFailureLabel(errorType)).toBe(FAILURE_DISPLAY[errorType])
    }
  })

  it('falls back gracefully for unknown error types', () => {
    expect(getFailureLabel('mystery')).toBe('Failed — mystery')
  })

  it('returns "Failed" when error type is null', () => {
    expect(getFailureLabel(null)).toBe('Failed')
  })
})

describe('isLegallyImportant', () => {
  it('flags overdue final as legally important', () => {
    expect(isLegallyImportant('overdue_email_final')).toBe(true)
  })

  it('does not flag regular templates', () => {
    expect(isLegallyImportant('pre_due_email_first')).toBe(false)
  })

  it('handles null gracefully', () => {
    expect(isLegallyImportant(null)).toBe(false)
  })
})
