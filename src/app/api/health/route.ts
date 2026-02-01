import { NextResponse } from 'next/server'

/**
 * Health check endpoint for Fly.io
 * Returns 200 OK if the app is running
 */
export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  )
}
