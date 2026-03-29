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

interface PreviewBody {
  periodDate: string
  requestedBy: string
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(canService)
    if ('error' in auth) return auth.error

    const body: PreviewBody = await request.json()

    if (!body.periodDate) {
      return NextResponse.json({ error: 'periodDate is required' }, { status: 400 })
    }

    if (!body.requestedBy) {
      return NextResponse.json({ error: 'requestedBy is required' }, { status: 400 })
    }

    const client = getLedgerClient()

    const response = await client.previewPeriodClose({
      periodDate: body.periodDate,
      requestedBy: body.requestedBy,
    })

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error generating period close preview:', error)
    return NextResponse.json(
      { error: 'Failed to generate preview', details: (error as Error).message },
      { status: 500 },
    )
  }
}
