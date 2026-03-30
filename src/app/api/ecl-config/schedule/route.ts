/**
 * API Route: POST /api/ecl-config/schedule
 *
 * Schedule a future config change.
 *
 * Body:
 * - fieldName: string (required) - Field to change
 * - newValue: string (required) - New value
 * - effectiveDate: string (required) - When change takes effect (YYYY-MM-DD)
 * - createdBy: string (optional, server-derived) - User scheduling the change
 */

import { NextRequest, NextResponse } from 'next/server'
import { getLedgerClient } from '@/server/grpc-client'
import { requireAuth } from '@/lib/auth'
import { hasApprovalAuthority } from '@/lib/access'
import { ScheduleConfigChangeSchema } from '@/lib/schemas/api'

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(hasApprovalAuthority)
    if ('error' in auth) return auth.error
    const { user, payload } = auth

    const rawBody = await request.json()
    const parseResult = ScheduleConfigChangeSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parseResult.error.flatten().fieldErrors },
        { status: 400 },
      )
    }
    const body = parseResult.data

    // Handle both 'parameter' (from frontend) and 'fieldName' (direct API call)
    let fieldName: string
    if (body.fieldName) {
      fieldName = body.fieldName
    } else if (body.parameter) {
      // Map parameter + bucket to fieldName
      if (body.parameter === 'pd_rate') {
        if (!body.bucket) {
          return NextResponse.json(
            { error: 'bucket is required for pd_rate parameter' },
            { status: 400 },
          )
        }
        // Map new bucket names to field name format
        fieldName = `pd_rate_${body.bucket}`
      } else if (body.parameter === 'overlay_multiplier') {
        fieldName = 'overlay_multiplier'
      } else if (body.parameter === 'lgd') {
        fieldName = 'lgd'
      } else {
        return NextResponse.json(
          { error: `Unknown parameter: ${body.parameter}` },
          { status: 400 },
        )
      }
    } else {
      return NextResponse.json(
        { error: 'fieldName or parameter is required' },
        { status: 400 },
      )
    }

    if (body.newValue === undefined || body.newValue === null) {
      return NextResponse.json(
        { error: 'newValue is required' },
        { status: 400 },
      )
    }

    if (!body.effectiveDate) {
      return NextResponse.json(
        { error: 'effectiveDate is required' },
        { status: 400 },
      )
    }

    // Convert newValue to string (gRPC expects Decimal as string)
    const newValueStr = typeof body.newValue === 'number' 
      ? body.newValue.toString() 
      : body.newValue

    // Look up username from user ID
    const userId = String(user.id)
    let createdByName = userId
    if (userId.length === 24) {
      // Looks like a MongoDB ObjectId (user GUID), try to look up the username
      try {
        const userResult = await payload.findByID({
          collection: 'users',
          id: userId,
        })

        if (userResult) {
          createdByName = userResult.firstName && userResult.lastName
            ? `${userResult.firstName} ${userResult.lastName}`
            : userResult.email || userId
        }
      } catch (userError) {
        console.warn('[Schedule Config] Could not look up user, using GUID:', userError)
        // Continue with GUID if lookup fails
      }
    }

    const client = getLedgerClient()

    try {
      const response = await client.scheduleECLConfigChange({
        fieldName,
        newValue: newValueStr,
        effectiveDate: body.effectiveDate,
        createdBy: createdByName, // Send username instead of GUID
      })

      // Transform the gRPC response
      const grpcResponse = response as any
      const transformedResponse = {
        success: true,
        changeId: grpcResponse.changeId ?? grpcResponse.change_id ?? '',
        fieldName: grpcResponse.fieldName ?? grpcResponse.field_name ?? fieldName,
        newValue: grpcResponse.newValue ?? grpcResponse.new_value ?? newValueStr,
        effectiveDate: grpcResponse.effectiveDate ?? grpcResponse.effective_date ?? body.effectiveDate,
        createdAt: grpcResponse.createdAt ?? grpcResponse.created_at ?? new Date().toISOString(),
        createdBy: grpcResponse.createdBy ?? grpcResponse.created_by ?? createdByName,
      }

        return NextResponse.json(transformedResponse)
    } catch (grpcError: unknown) {
      const error = grpcError as { code?: number; message?: string; details?: string }
      
      console.error('[Schedule Config] gRPC error:', {
        code: error.code,
        message: error.message,
        details: error.details,
        error: grpcError,
      })
      
      // Handle UNAVAILABLE (14), UNIMPLEMENTED (12), or missing client method
      if (
        error.code === 14 ||
        error.code === 12 ||
        error.message?.includes('UNAVAILABLE') ||
        error.message?.includes('not implemented') ||
        error.message?.includes('call') ||
        error.message?.includes('undefined')
      ) {
        console.warn('Ledger service unavailable or method not implemented for schedule config change')
        return NextResponse.json(
          {
            error: 'Schedule config change service not available',
            message: 'The scheduled config change service is not currently available. Please try again later.',
          },
          { status: 503 },
        )
      }
      throw grpcError
    }
  } catch (error) {
    console.error('Error scheduling config change:', error)
    return NextResponse.json(
      { error: 'Failed to schedule config change', details: 'An internal error occurred. Please try again.' },
      { status: 500 },
    )
  }
}
