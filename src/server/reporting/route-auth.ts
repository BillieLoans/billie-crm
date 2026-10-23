/**
 * Small helpers for the Reports API routes. Authentication itself is
 * `requireAuth(hasAnyRole)` from `@/lib/auth`.
 */
import { NextResponse } from 'next/server'

export function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status })
}
