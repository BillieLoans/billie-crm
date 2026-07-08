/**
 * API Route: GET /api/marketing/contacts/[contactId]/export
 *
 * Subject-access export (phase 3 DSR): everything the marketing system of
 * record holds about one contact, merged with the CRM's audit trail, as a
 * downloadable JSON document. ADMIN ONLY — this is personal data assembled
 * for a data-subject request, not a routine staff view.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { isAdmin } from '@/lib/access'
import { exportContact } from '@/server/marketing-grpc-client'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> },
) {
  const auth = await requireAuth(isAdmin)
  if ('error' in auth) return auth.error
  const { payload, user } = auth
  const { contactId } = await params

  try {
    const result = await exportContact({ contactId, actor: String(user.id) })

    // Merge the CRM-side audit trail (projection of the same events, but the
    // platform doesn't hold it) so the document is complete.
    const audit = await payload.find({
      collection: 'contact-audit-log',
      where: { contactIdString: { equals: contactId } } as never,
      limit: 1000,
      sort: 'occurredAt',
      overrideAccess: false,
      user,
    })

    const document = {
      ...JSON.parse(result.exportJson),
      audit_trail: audit.docs.map((row) => ({
        event_type: row.eventType,
        actor: row.actor,
        occurred_at: row.occurredAt,
        detail: row.detail,
      })),
    }

    return new NextResponse(JSON.stringify(document, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-disposition': `attachment; filename="subject-access-${contactId}.json"`,
      },
    })
  } catch (e) {
    console.error('[Marketing Export Contact] gRPC error:', e)
    return NextResponse.json(
      { error: { code: 'EXPORT_FAILED', message: 'Export failed. Please retry.' } },
      { status: 503 },
    )
  }
}
