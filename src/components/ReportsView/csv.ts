import Papa from 'papaparse'
import type { ReportColumn } from '@/lib/schemas/reports'
import { sydneyDateString } from '@/lib/disbursement-cutoff'

/**
 * A cell that a spreadsheet would read as a formula. Prefixed with `'` so
 * opening the CSV in Excel or Sheets never runs it (CSV injection).
 */
const FORMULA_START = /^[=+\-@\t\r]/
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/

function safeCell(value: unknown): unknown {
  if (typeof value === 'string' && FORMULA_START.test(value) && !PLAIN_NUMBER.test(value)) {
    return `'${value}`
  }
  if (value !== null && typeof value === 'object') return JSON.stringify(value)
  return value
}

/** The result as CSV, raw values (ISO dates, unformatted numbers). */
export function toCsv(
  columns: readonly ReportColumn[],
  rows: ReadonlyArray<Record<string, unknown>>,
): string {
  const fields = columns.map((c) => c.name)
  return Papa.unparse(
    {
      // Column names come from report SQL, so they are neutralised too.
      fields: fields.map((f) => String(safeCell(f))),
      data: rows.map((row) => fields.map((f) => safeCell(row[f]))),
    },
    { newline: '\r\n' },
  )
}

/** `<slug>-<YYYY-MM-DD>.csv`, dated by the Sydney business day. */
export function csvFileName(slug: string, now: Date = new Date()): string {
  return `${slug}-${sydneyDateString(now)}.csv`
}

/** Save text as a file in the browser. */
export function downloadText(
  text: string,
  fileName: string,
  type = 'text/csv;charset=utf-8',
): void {
  // A BOM so Excel opens UTF-8 correctly.
  const blob = new Blob(['﻿', text], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoke after the browser has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
