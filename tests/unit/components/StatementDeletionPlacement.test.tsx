import React from 'react'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ConversationDetail } from '@/lib/schemas/conversations'

let currentUser: { role: string } | null = null
let latestDeletion: unknown = null

vi.mock('@payloadcms/ui', () => ({
  useAuth: () => ({ user: currentUser }),
}))

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: React.PropsWithChildren<{ href: string; [k: string]: unknown }>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/hooks/queries/useAssessments', () => ({
  useAccountConductAssessment: vi.fn(),
  useServiceabilityAssessment: vi.fn(),
  usePostIdentityRiskAssessment: vi.fn(() => ({ data: undefined, isLoading: false, error: null })),
}))

vi.mock('@/hooks/queries/useStatementDeletion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/queries/useStatementDeletion')>()
  return {
    ...actual,
    useStatementDeletion: () => ({ data: latestDeletion }),
  }
})

vi.mock('@/hooks/queries/useConversations', () => ({
  useCustomerConversations: () => ({
    data: { conversations: [] },
    isLoading: false,
    error: null,
  }),
}))

import { AssessmentPanel } from '@/components/ConversationDetailView/AssessmentPanel'
import { ApplicationsPanel } from '@/components/ServicingView/ApplicationsPanel'

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  )

function conversation(overrides: Partial<ConversationDetail> = {}): ConversationDetail {
  return {
    conversationId: 'conv-001',
    applicationNumber: 'APP-001',
    status: 'active',
    decisionStatus: null,
    finalDecision: null,
    customer: { fullName: 'Jane Smith', customerId: 'CUS-001' },
    application: { loanAmount: 5000, purpose: 'New car', term: 10 },
    utterances: [],
    noticeboard: [],
    assessments: {},
    messageCount: 5,
    statementCapture: {
      consentStatus: 'GRANTED',
      retrievalComplete: true,
      fileLocations: { statementData: 's3://bucket/a.json' },
    },
    ...overrides,
  } as ConversationDetail
}

const openStatements = () => fireEvent.click(screen.getByRole('button', { name: /Statements/ }))

const DELETION = {
  occurredAt: '2026-11-10T03:04:00Z',
  actorName: 'Sam Supervisor',
  actorEmail: 'sam@example.com',
  filesDeleted: 4,
  reason: 'Customer request',
  status: 'deleted',
}

beforeEach(() => {
  currentUser = { role: 'supervisor' }
  latestDeletion = null
})
afterEach(() => cleanup())

describe('Statements section — deletion placement', () => {
  it('shows the file buttons and the delete button when nothing is deleted', () => {
    wrap(<AssessmentPanel conversation={conversation()} conversationId="conv-001" />)
    openStatements()
    expect(screen.getByText(/Bank statement data/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete statement files…' })).toBeInTheDocument()
  })

  it('shows the note in place of the file buttons after a deletion', () => {
    latestDeletion = DELETION
    wrap(<AssessmentPanel conversation={conversation()} conversationId="conv-001" />)
    openStatements()
    expect(screen.queryByText(/Bank statement data/)).not.toBeInTheDocument()
    expect(screen.getByText(/Statement files deleted/)).toHaveTextContent(/by Sam Supervisor/)
    expect(screen.getByText(/4 files removed · Reason: Customer request/)).toBeInTheDocument()
    expect(screen.queryByText(/some files could not be deleted/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete statement files…' })).toBeInTheDocument()
  })

  it('falls back to the actor email and flags a partial deletion', () => {
    latestDeletion = { ...DELETION, actorName: null, status: 'partial' }
    wrap(<AssessmentPanel conversation={conversation()} conversationId="conv-001" />)
    openStatements()
    expect(screen.getByText(/Statement files deleted/)).toHaveTextContent(/by sam@example.com/)
    expect(screen.getByText(/some files could not be deleted/)).toBeInTheDocument()
  })

  it('still offers the delete button when there is no statement capture data', () => {
    wrap(
      <AssessmentPanel
        conversation={conversation({ statementCapture: undefined })}
        conversationId="conv-001"
      />,
    )
    openStatements()
    expect(screen.getByText('No statement capture data.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete statement files…' })).toBeInTheDocument()
  })

  it('hides the delete button from operations users', () => {
    currentUser = { role: 'operations' }
    wrap(<AssessmentPanel conversation={conversation()} conversationId="conv-001" />)
    openStatements()
    expect(
      screen.queryByRole('button', { name: 'Delete statement files…' }),
    ).not.toBeInTheDocument()
  })
})

describe('Applications panel — customer deletion', () => {
  it('shows the customer-wide button for a supervisor', () => {
    wrap(<ApplicationsPanel customerIdString="CUS-001" />)
    expect(
      screen.getByRole('button', { name: 'Delete statement files for all applications…' }),
    ).toBeInTheDocument()
  })

  it('hides it for operations', () => {
    currentUser = { role: 'operations' }
    wrap(<ApplicationsPanel customerIdString="CUS-001" />)
    expect(
      screen.queryByRole('button', { name: 'Delete statement files for all applications…' }),
    ).not.toBeInTheDocument()
  })
})
