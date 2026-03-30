/**
 * API Route: POST /api/investigation/sample
 *
 * Generate a random sample of accounts.
 *
 * Body:
 * - bucket: string (optional) - Filter by aging bucket
 * - eclMin: string (optional) - Minimum ECL
 * - eclMax: string (optional) - Maximum ECL
 * - carryingAmountMin: string (optional) - Minimum carrying amount
 * - carryingAmountMax: string (optional) - Maximum carrying amount
 * - sampleSize: number (optional) - Sample size (default: 50, max: 500)
 * - seed: string (optional) - Seed for reproducibility
 * - allowFullScan: boolean (optional) - Allow full scan without filters
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasAnyRole } from '@/lib/access'
import { SampleQuerySchema } from '@/lib/schemas/api'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(hasAnyRole)
    if ('error' in auth) return auth.error

    const rawBody = await request.json()
    const parseResult = SampleQuerySchema.safeParse(rawBody)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const body = parseResult.data

    const client = getLedgerClient()

    const response = await client.generateRandomSample({
      bucket: body.bucket,
      eclMin: body.eclMin,
      eclMax: body.eclMax,
      carryingAmountMin: body.carryingAmountMin,
      carryingAmountMax: body.carryingAmountMax,
      sampleSize: body.sampleSize,
      seed: body.seed,
      allowFullScan: body.allowFullScan,
    })

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error generating sample:', error)
    return NextResponse.json(
      { error: 'Failed to generate sample', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
