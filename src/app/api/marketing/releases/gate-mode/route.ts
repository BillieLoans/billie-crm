/**
 * POST /api/marketing/releases/gate-mode — admin-only gate-mode control
 * (spec §6 "Gate control"). A second command surface alongside the ops CLI
 * break-glass path; publishes applicant_release.gate_mode.set.v1 to
 * chatLedger, which billieChat's applicantReleaseService applies and
 * reflects back via `.changed` into the release-gate-status projection.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { isAdmin } from '@/lib/access'
import { publishGateModeCommand } from '@/server/release-publisher'
import { EventPublishError } from '@/server/event-publisher'

const SetGateModeSchema = z.object({
  mode: z.enum(['open', 'gated', 'closed']),
  reason: z.string().max(500).optional(),
})

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(isAdmin)
    if ('error' in auth) return auth.error
    const { user } = auth

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Body must be valid JSON' } },
        { status: 400 },
      )
    }
    const parsed = SetGateModeSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid gate mode payload',
            details: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 400 },
      )
    }

    const { eventId } = await publishGateModeCommand({
      mode: parsed.data.mode,
      usr: String(user.id),
      reason: parsed.data.reason,
    })

    return NextResponse.json({ mode: parsed.data.mode, eventId }, { status: 202 })
  } catch (error) {
    console.error('[Gate Mode] Error:', error)
    if (error instanceof EventPublishError) {
      return NextResponse.json(
        {
          error: {
            code: 'EVENT_PUBLISH_FAILED',
            message: 'Failed to publish the gate mode change. Please try again.',
          },
        },
        { status: 503 },
      )
    }
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } },
      { status: 500 },
    )
  }
}
