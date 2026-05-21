/**
 * GET /api/conversations/:conversationId/statements/file?slot=<slot>&format=<raw|parsed>
 *
 * Returns a statement-capture file from S3. The S3 URI is read from
 * `conversations.statement_capture.fileLocations[slot]` (populated by the
 * Python handler from the `statement_retrieval_complete` event).
 *
 * format=raw (default): streams the file bytes with the right Content-Type.
 * format=parsed: returns JSON envelope { kind: 'json'|'csv'|'text', filename, data }
 *
 * Valid slots: statementData | categorizedTransactions | affordabilityReport | accounts
 */

import { NextRequest, NextResponse } from 'next/server'
import { getPayload } from 'payload'
import { headers } from 'next/headers'
import configPromise from '@payload-config'
import { hasAnyRole } from '@/lib/access'
import { getObjectByUri, parseS3Uri } from '@/server/s3-client'
import { checkRateLimit, ASSESSMENT_RATE_LIMIT } from '@/lib/utils/rateLimit'

const VALID_SLOTS = ['statementData', 'categorizedTransactions', 'affordabilityReport', 'accounts'] as const
type Slot = (typeof VALID_SLOTS)[number]

interface RouteParams {
  params: Promise<{ conversationId: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { conversationId } = await params
  const slot = request.nextUrl.searchParams.get('slot') as Slot | null
  const format = (request.nextUrl.searchParams.get('format') ?? 'raw') as 'raw' | 'parsed'

  if (!slot || !VALID_SLOTS.includes(slot)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid or missing slot.' } },
      { status: 400 },
    )
  }
  if (format !== 'raw' && format !== 'parsed') {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid format.' } },
      { status: 400 },
    )
  }

  try {
    const payload = await getPayload({ config: configPromise })
    const headersList = await headers()
    const cookieHeader = headersList.get('cookie') || ''

    const { user } = await payload.auth({ headers: new Headers({ cookie: cookieHeader }) })
    if (!user) {
      return NextResponse.json(
        { error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue.' } },
        { status: 401 },
      )
    }
    if (!hasAnyRole(user)) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Insufficient permissions.' } },
        { status: 403 },
      )
    }

    if (!checkRateLimit(`statement-file:${String(user.id)}`, ASSESSMENT_RATE_LIMIT)) {
      return NextResponse.json(
        { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } },
        { status: 429 },
      )
    }

    const result = await payload.find({
      collection: 'conversations',
      where: { conversationId: { equals: conversationId } },
      limit: 1,
      select: { statementCapture: true },
    })

    const doc = result.docs[0]
    if (!doc) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'Conversation not found.' } },
        { status: 404 },
      )
    }

    const sc = doc.statementCapture as
      | { fileLocations?: Partial<Record<Slot, string>> | null }
      | null
      | undefined
    const s3Uri = sc?.fileLocations?.[slot]
    if (!s3Uri) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'File not available.' } },
        { status: 404 },
      )
    }

    try {
      const { key } = parseS3Uri(s3Uri)
      if (key.includes('..')) {
        return NextResponse.json(
          { error: { code: 'FORBIDDEN', message: 'Invalid file key.' } },
          { status: 403 },
        )
      }
    } catch {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Invalid file key.' } },
        { status: 403 },
      )
    }

    const object = await getObjectByUri(s3Uri)
    if (!object) {
      return NextResponse.json(
        { error: { code: 'NOT_FOUND', message: 'File not found in storage.' } },
        { status: 404 },
      )
    }

    const filename = s3Uri.split('/').pop() || `${slot}.bin`
    const contentType = guessContentType(filename, object.contentType)

    if (format === 'parsed') {
      const text = await streamToString(object.body)
      const lower = filename.toLowerCase()
      if (lower.endsWith('.json')) {
        let data: unknown
        try {
          data = JSON.parse(text)
        } catch {
          return NextResponse.json(
            { error: { code: 'PARSE_ERROR', message: 'File is not valid JSON.' } },
            { status: 502 },
          )
        }
        return NextResponse.json({ kind: 'json', filename, data })
      }
      if (lower.endsWith('.csv')) {
        return NextResponse.json({ kind: 'csv', filename, data: parseCsv(text) })
      }
      return NextResponse.json({ kind: 'text', filename, data: text })
    }

    return new NextResponse(object.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${filename}"`,
        ...(object.contentLength != null
          ? { 'Content-Length': String(object.contentLength) }
          : {}),
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    console.error('[GET /api/conversations/:id/statements/file] Error:', {
      conversationId,
      slot,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to load file.' } },
      { status: 500 },
    )
  }
}

function guessContentType(filename: string, fallback: string): string {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.csv')) return 'text/csv'
  if (lower.endsWith('.pdf')) return 'application/pdf'
  return fallback
}

async function streamToString(body: ReadableStream): Promise<string> {
  // The SDK's Body stream exposes `transformToString` on the runtime stream
  // wrapper; fall back to a manual reader if it's missing.
  const maybeTransform = body as unknown as { transformToString?: () => Promise<string> }
  if (typeof maybeTransform.transformToString === 'function') {
    return maybeTransform.transformToString()
  }
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  return new TextDecoder('utf-8').decode(
    chunks.reduce<Uint8Array>((acc, chunk) => {
      const combined = new Uint8Array(acc.length + chunk.length)
      combined.set(acc, 0)
      combined.set(chunk, acc.length)
      return combined
    }, new Uint8Array()),
  )
}

interface CsvData {
  headers: string[]
  rows: string[][]
  totalRows: number
  truncated: boolean
}

const CSV_ROW_LIMIT = 2000

/**
 * Minimal RFC 4180 CSV parser. Handles quoted fields with embedded commas,
 * newlines, and escaped quotes. Truncates to CSV_ROW_LIMIT rows.
 */
function parseCsv(text: string): CsvData {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += ch
      i += 1
      continue
    }
    if (ch === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (ch === '\r' && text[i + 1] === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 2
      continue
    }
    if (ch === '\n' || ch === '\r') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      continue
    }
    field += ch
    i += 1
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  const [headerRow, ...dataRows] = rows
  const headers = headerRow ?? []
  const totalRows = dataRows.length
  const truncated = totalRows > CSV_ROW_LIMIT
  return {
    headers,
    rows: truncated ? dataRows.slice(0, CSV_ROW_LIMIT) : dataRows,
    totalRows,
    truncated,
  }
}
