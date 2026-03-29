/**
 * API Route: POST /api/period-close/finalize
 *
 * Finalize a period close.
 *
 * Body:
 * - previewId: string (required) - Preview ID to finalize
 * - finalizedBy: string (optional, server-derived) - User finalizing
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasApprovalAuthority } from '@/lib/access'
import { FinalizePeriodCloseSchema } from '@/lib/schemas/api'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(hasApprovalAuthority)
    if ('error' in auth) return auth.error
    const { user } = auth

    const body = await request.json()
    const parseResult = FinalizePeriodCloseSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const data = parseResult.data

    const client = getLedgerClient()

    const response = await client.finalizePeriodClose({
      previewId: data.previewId,
      finalizedBy: String(user.id),
    })

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error finalizing period close:', error)
    return NextResponse.json(
      { error: 'Failed to finalize period close', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
