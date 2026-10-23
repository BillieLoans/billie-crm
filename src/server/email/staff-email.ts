/**
 * Staff email through Resend (BTB-507), for scheduled reports.
 *
 * Deliberately not Payload's email adapter: configuring one would also make
 * Payload's forgot-password email live for staff accounts. This client is
 * used only by the code that calls it.
 *
 * Resend is the provider platform-services already sends customer email
 * with; the same verified sender is the default.
 */

export interface StaffEmail {
  to: string[]
  subject: string
  html: string
  attachments?: Array<{ filename: string; contentBase64: string }>
}

export class StaffEmailError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'StaffEmailError'
  }
}

/** True when staff email can be sent. */
export function staffEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

/**
 * Send one email to every recipient in a single request, so a delivery is
 * all-or-nothing rather than per recipient.
 *
 * @throws StaffEmailError when Resend is not configured or refuses the send.
 */
export async function sendStaffEmail(email: StaffEmail, idempotencyKey: string): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new StaffEmailError('RESEND_API_KEY is not set')
  const from = `Billie CRM <${process.env.RESEND_FROM_ADDRESS || 'noreply@billie.loans'}>`
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      // Resend drops a repeat of the same key within 24 hours.
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      from,
      to: email.to,
      subject: email.subject,
      html: email.html,
      attachments: email.attachments?.map((a) => ({
        filename: a.filename,
        content: a.contentBase64,
      })),
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null
  if (!res.ok) {
    throw new StaffEmailError(
      `Resend refused the email: ${body?.message ?? res.status}`,
      res.status,
    )
  }
  return body?.id ?? ''
}
