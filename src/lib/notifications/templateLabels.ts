/**
 * Friendly labels for notification templates.
 *
 * Source: docs/Notification events — CRM integration spec v2.md §1e.
 * When the spec adds new templates, mirror them here so the Communications
 * timeline shows a human-readable label instead of the raw template_name.
 *
 * Fallback strategy when a template_name isn't in this map: the UI falls
 * back to `tags.reason + tags.step` (also from the spec), and finally to
 * the raw template_name.
 */

export interface TemplateMeta {
  /** Friendly title shown in the Communications timeline. */
  label: string
  /** Channel inferred from the template, used as a fallback if the event
   *  payload's channel field is absent. */
  channel: 'email' | 'sms'
  /** True for legally significant notices that should be visually weighted. */
  legallyImportant?: boolean
}

export const TEMPLATE_META: Record<string, TemplateMeta> = {
  // Pre-due reminders
  pre_due_email_first: {
    label: 'First pre-due reminder',
    channel: 'email',
  },
  pre_due_email_first_fallback_sms: {
    label: 'First pre-due reminder (SMS fallback)',
    channel: 'sms',
  },
  pre_due_sms_second: {
    label: 'Second pre-due reminder',
    channel: 'sms',
  },
  pre_due_sms_second_fallback_email: {
    label: 'Second pre-due reminder (email fallback)',
    channel: 'email',
  },

  // Overdue notices
  overdue_email_v1: { label: 'Overdue notice — step 1', channel: 'email' },
  overdue_sms_v1: { label: 'Overdue notice — step 2', channel: 'sms' },
  overdue_email_v2: { label: 'Overdue notice — step 3', channel: 'email' },
  overdue_sms_v2: { label: 'Overdue notice — step 4', channel: 'sms' },
  overdue_email_final: {
    label: 'Final notice',
    channel: 'email',
    legallyImportant: true,
  },

  // Statements
  statement_monthly_email: {
    label: 'Monthly statement',
    channel: 'email',
  },
}

export function getTemplateLabel(
  templateName: string | null | undefined,
  fallbackTags?: { reason?: string | null; step?: number | null } | null,
): string {
  if (templateName && TEMPLATE_META[templateName]) {
    return TEMPLATE_META[templateName].label
  }

  if (fallbackTags?.reason) {
    const stepSuffix = typeof fallbackTags.step === 'number' ? ` — step ${fallbackTags.step}` : ''
    // Make the reason somewhat human-readable: pre_due -> "Pre due"
    const humanReason = fallbackTags.reason
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
    return `${humanReason}${stepSuffix}`
  }

  return templateName || 'Notification'
}

export function isLegallyImportant(templateName: string | null | undefined): boolean {
  if (!templateName) return false
  return Boolean(TEMPLATE_META[templateName]?.legallyImportant)
}

/**
 * Human-readable status label for a notification.delivery_failed.v1 error_type.
 * Source: spec v2 §1d table.
 */
export const FAILURE_DISPLAY: Record<string, string> = {
  transient: 'Failed — temporary error',
  permanent: 'Failed — recipient invalid',
  auth: 'Failed — system error',
  template: 'Failed — template error',
  contact_missing: 'Failed — no contact details',
  opt_out: 'Suppressed — marketing opt-out',
  suppressed: 'Blocked — notification suppression active',
}

export function getFailureLabel(errorType: string | null | undefined): string {
  if (!errorType) return 'Failed'
  return FAILURE_DISPLAY[errorType] ?? `Failed — ${errorType}`
}
