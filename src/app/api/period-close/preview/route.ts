/**
 * API Route: POST /api/period-close/preview
 *
 * Generate a period close preview.
 *
 * Body:
 * - periodDate: string (required) - Period end date (YYYY-MM-DD)
 * - requestedBy: string (required) - User requesting the preview
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { canService } from '@/lib/access'
import { PeriodClosePreviewSchema } from '@/lib/schemas/api'
import { mapPreviewResponse } from '@/server/period-close-mapper'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error
    const { user } = auth

    const body = await request.json()
    const parseResult = PeriodClosePreviewSchema.safeParse(body)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const data = parseResult.data

    const client = getLedgerClient()

    const response = await client.previewPeriodClose({
      periodDate: data.periodDate,
      requestedBy: String(user.id),
    })

    return NextResponse.json(await mapPreviewResponse(response, auth.payload))
  } catch (error) {
    console.error('Error generating period close preview:', error)
    return NextResponse.json(
      { error: 'Failed to generate preview', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
