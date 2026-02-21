import { useInfiniteQuery } from '@tanstack/react-query'
import { stringify } from 'qs-esm'

export interface ContactNoteData {
  id: string
  channel: 'phone' | 'email' | 'sms' | 'internal' | 'system'
  topic:
    | 'general_enquiry'
    | 'complaint'
    | 'escalation'
    | 'internal_note'
    | 'account_update'
    | 'collections'
  contactDirection?: 'inbound' | 'outbound' | null
  subject: string
  content: unknown
  priority: 'low' | 'normal' | 'high' | 'urgent'
  sentiment: 'positive' | 'neutral' | 'negative' | 'escalation'
  status: 'active' | 'amended'
  amendsNote?: string | null | { id: string }
  customer: string | { id: string; fullName?: string | null }
  loanAccount?: string | null | { id: string; loanAccountId: string; accountNumber: string }
  createdBy: string | { id: string; firstName?: string | null; lastName?: string | null; email?: string | null }
  createdAt: string
  updatedAt: string
}

export interface ContactNotesFilters {
  topic?: string | null
  accountId?: string | null
}

export interface ContactNotesResult {
  notes: ContactNoteData[]
  totalDocs: number
  hasNextPage: boolean
  currentPage: number
}

interface ContactNotesResponse {
  docs: ContactNoteData[]
  totalDocs: number
  hasNextPage: boolean
  hasPrevPage: boolean
  page: number
}

async function fetchContactNotes(
  customerId: string,
  filters: ContactNotesFilters,
  page: number,
): Promise<ContactNotesResult> {
  const andClauses: Record<string, unknown>[] = [
    { 'customer': { equals: customerId } },
  ]

  if (filters.topic) {
    andClauses.push({ topic: { equals: filters.topic } })
  }

  if (filters.accountId === 'none') {
    andClauses.push({ loanAccount: { exists: false } })
  } else if (filters.accountId != null) {
    andClauses.push({ loanAccount: { equals: filters.accountId } })
  }

  const queryString = stringify(
    {
      where: { and: andClauses },
      depth: 1,
      sort: '-createdAt',
      limit: 5,
      page,
    },
    { addQueryPrefix: true },
  )

  const res = await fetch(`/api/contact-notes${queryString}`)

  if (!res.ok) {
    throw new Error('Failed to fetch contact notes')
  }

  const data: ContactNotesResponse = await res.json()

  return {
    notes: data.docs,
    totalDocs: data.totalDocs,
    hasNextPage: data.hasNextPage,
    currentPage: data.page,
  }
}

export const contactNotesQueryKey = (customerId: string, filters: ContactNotesFilters) =>
  ['contact-notes', customerId, filters] as const

export interface UseContactNotesResult {
  notes: ContactNoteData[]
  totalDocs: number
  hasNextPage: boolean
  isLoading: boolean
  isSuccess: boolean
  isError: boolean
  error: Error | null
  fetchStatus: 'fetching' | 'paused' | 'idle'
  isFetchingNextPage: boolean
  fetchNextPage: () => Promise<unknown>
}

export function useContactNotes(
  customerId: string,
  filters: ContactNotesFilters = {},
): UseContactNotesResult {
  const query = useInfiniteQuery({
    queryKey: contactNotesQueryKey(customerId, filters),
    queryFn: ({ pageParam }) => fetchContactNotes(customerId, filters, pageParam),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => (lastPage.hasNextPage ? lastPage.currentPage + 1 : undefined),
    enabled: !!customerId,
    staleTime: 10_000,
  })

  const pages = query.data?.pages ?? []

  return {
    notes: pages.flatMap((page) => page.notes),
    totalDocs: pages[0]?.totalDocs ?? 0,
    hasNextPage: query.hasNextPage ?? false,
    isLoading: query.isLoading,
    isSuccess: query.isSuccess,
    isError: query.isError,
    error: (query.error as Error | null) ?? null,
    fetchStatus: query.fetchStatus,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
  }
}
