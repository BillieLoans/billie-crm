/**
 * ApplicationsView — Tiles | List layout toggle wiring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import React from 'react'
import type { ConversationSummary } from '@/lib/schemas/conversations'

const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/admin/applications',
}))
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: React.PropsWithChildren<{ href: string; [key: string]: unknown }>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))
const prefs = vi.hoisted(() => ({
  getPreference: vi.fn().mockResolvedValue(null),
  setPreference: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@payloadcms/ui', () => ({
  usePreferences: () => prefs,
}))

const useConversationsMock = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/queries/useConversations', () => ({
  useConversations: useConversationsMock,
}))

import { ApplicationsView } from '@/components/ApplicationsView'
import { useConversationFiltersStore } from '@/stores/conversationFilters'

const ROW: ConversationSummary = {
  conversationId: 'conv-1',
  customer: { fullName: 'Rohan Sharp', customerId: 'B81FC35E' },
  applicationNumber: 'F68420AA-67F',
  status: 'cancelled',
  decisionStatus: null,
  application: { loanAmount: 100, purpose: 'Bill payment' },
  messageCount: 12,
  lastMessageAt: '2026-10-07T09:40:00.000Z',
  updatedAt: '2026-10-07T09:40:00.000Z',
  startedAt: '2026-10-06T00:00:00.000Z',
}

describe('ApplicationsView layout toggle', () => {
  beforeEach(() => {
    useConversationsMock.mockReset().mockReturnValue({
      data: { conversations: [ROW], hasMore: false, total: 1 },
      isLoading: false,
      isError: false,
      error: null,
      dataUpdatedAt: Date.now(),
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    })
    act(() => useConversationFiltersStore.setState({ viewMode: 'tiles', sort: '-updatedAt' }))
  })

  it('shows cards by default and switches to the table on List', () => {
    render(<ApplicationsView />)
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByRole('link', { name: /F68420AA-67F/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('sends the chosen sort to the query and resets it on return to tiles', () => {
    render(<ApplicationsView />)
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    fireEvent.click(screen.getByRole('button', { name: /Started/ }))
    const lastCall = useConversationsMock.mock.calls.at(-1)?.[0] as { sort?: string }
    expect(lastCall.sort).toBe('-startedAt')

    fireEvent.click(screen.getByRole('button', { name: 'Tiles' }))
    const afterTiles = useConversationsMock.mock.calls.at(-1)?.[0] as { sort?: string }
    expect(afterTiles.sort).toBeUndefined()
  })
})
