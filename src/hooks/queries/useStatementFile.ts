'use client'

import { useQuery } from '@tanstack/react-query'

export type StatementSlot =
  | 'statementData'
  | 'categorizedTransactions'
  | 'affordabilityReport'
  | 'accounts'

export interface CsvData {
  headers: string[]
  rows: string[][]
  totalRows: number
  truncated: boolean
}

export type StatementFileContent =
  | { kind: 'json'; filename: string; data: unknown }
  | { kind: 'csv'; filename: string; data: CsvData }
  | { kind: 'text'; filename: string; data: string }

async function fetchStatementFile(
  conversationId: string,
  slot: StatementSlot,
): Promise<StatementFileContent | null> {
  const url = `/api/conversations/${encodeURIComponent(conversationId)}/statements/file?slot=${slot}&format=parsed`
  const res = await fetch(url, { cache: 'no-store' })
  if (res.status === 404) return null
  if (!res.ok) {
    const err = await res.json().catch(() => null)
    throw new Error(err?.error?.message ?? `Statement file fetch failed: ${res.status}`)
  }
  return (await res.json()) as StatementFileContent
}

export function useStatementFile(
  conversationId: string | undefined,
  slot: StatementSlot | undefined,
) {
  return useQuery({
    queryKey: ['statement-file', conversationId, slot],
    queryFn: () => fetchStatementFile(conversationId!, slot!),
    enabled: !!conversationId && !!slot,
    staleTime: Infinity,
    retry: false,
  })
}

export function rawStatementFileUrl(conversationId: string, slot: StatementSlot): string {
  return `/api/conversations/${encodeURIComponent(conversationId)}/statements/file?slot=${slot}`
}
