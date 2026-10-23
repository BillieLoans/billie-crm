/**
 * GET/POST /api/reports/subscriptions — the signed-in user's report emails
 * and alerts.
 *
 * POST body: `{ kind: 'digest', slug, frequency, range?, parameters?, channel? }`
 * or `{ kind: 'alert', slug, range?, parameters?, channel?, alert: { column,
 * row?, value?, operator, threshold } }`. The person must be able to run
 * the report; Slack is for report authors.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { subscriptionRequestSchema } from '@/lib/reports/subscriptions'
import { errorResponse } from '@/server/reporting/route-auth'
import { isReportAuthor } from '@/server/reporting/run-report'
import { slackConfigured } from '@/server/reporting/slack'
import {
  SubscriptionError,
  createSubscription,
  listSubscriptions,
} from '@/server/reporting/subscriptions'

export async function GET() {
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error
  try {
    return NextResponse.json({
      subscriptions: await listSubscriptions(auth.payload, auth.user),
      slack: isReportAuthor(auth.user) && slackConfigured(),
    })
  } catch (error) {
    console.error('[reports] could not list subscriptions:', error)
    return errorResponse(500, 'LIST_FAILED', 'Your report emails could not be loaded. Try again.')
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(hasAnyRole)
  if ('error' in auth) return auth.error
  const parsed = subscriptionRequestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return errorResponse(400, 'BAD_REQUEST', 'Choose how often, and for an alert, the threshold.')
  }
  try {
    const subscription = await createSubscription(auth.payload, auth.user, parsed.data)
    return NextResponse.json({ subscription }, { status: 201 })
  } catch (error) {
    if (error instanceof SubscriptionError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message, fields: error.fields } },
        { status: error.status },
      )
    }
    console.error('[reports] could not create a subscription:', error)
    return errorResponse(500, 'SAVE_FAILED', 'That could not be saved. Try again.')
  }
}
