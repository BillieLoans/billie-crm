/**
 * Tests for StatementFileViewer — the drawer that renders the downloaded
 * bank-statement files (statement data JSON, categorised CSV, etc.).
 *
 * Bank statement data from bankstatements.com.au keys the account list by an
 * arbitrary bank key (`cba`, `anz`, … — `bank_of_statements` is only the
 * sandbox). The viewer must recognise every key and render the structured
 * account/transaction layout, not fall back to the generic JSON grid.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import { StatementFileViewer } from '@/components/ConversationDetailView/StatementFileViewer'

vi.mock('@payloadcms/ui', () => ({
  useAuth: () => ({ user: null }),
}))

vi.mock('@/hooks', () => ({
  useStatementFile: vi.fn(),
  rawStatementFileUrl: (id: string, slot: string) => `/raw/${id}/${slot}`,
}))

import { useStatementFile } from '@/hooks'

const mockedUseStatementFile = vi.mocked(useStatementFile)

function mockFile(data: unknown) {
  mockedUseStatementFile.mockReturnValue({
    data: { kind: 'json', filename: 'cba_statements_20261015_070648.json', data },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useStatementFile>)
}

const cbaAccount = {
  name: 'Smart Access',
  accountNumber: '470062',
  id: '0',
  bsb: '062000',
  balance: '9.12',
  available: '0',
  accountType: 'transaction',
  accountHolder: 'KEN SMITH',
  accountHolderType: 'single',
  institution: 'Commonwealth Bank',
  statementData: {
    details: [
      {
        date: '15-10-2026',
        dateObj: { date: '2026-10-15 00:00:00.000000', timezone_type: 3, timezone: 'UTC' },
        text: 'WOOLWORTHS 1234 SYDNEY',
        amount: 42.5,
        type: 'Debit',
        balance: '9.12',
        tags: ['Groceries'],
        notes: null,
      },
      {
        date: '14-10-2026',
        dateObj: { date: '2026-10-14 00:00:00.000000', timezone_type: 3, timezone: 'UTC' },
        text: 'SALARY ACME PTY LTD',
        amount: 1500,
        type: 'Credit',
        balance: '51.62',
        tags: ['Income'],
        notes: null,
      },
    ],
  },
}

describe('StatementFileViewer — bank statement data', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders the structured account layout for a non-sandbox bank key', () => {
    mockFile({ accounts: { cba: { accounts: [cbaAccount] } }, user_token: 'x' })

    render(<StatementFileViewer conversationId="conv-1" slot="statementData" onClose={() => {}} />)

    // Structured account card
    expect(screen.getByText('Smart Access')).toBeInTheDocument()
    expect(screen.getByText('KEN SMITH')).toBeInTheDocument()
    expect(screen.getByText('Commonwealth Bank')).toBeInTheDocument()

    // Transaction table with real column headers
    expect(screen.getByRole('columnheader', { name: 'Description' })).toBeInTheDocument()
    expect(screen.getByText('WOOLWORTHS 1234 SYDNEY')).toBeInTheDocument()
    expect(screen.getByText('SALARY ACME PTY LTD')).toBeInTheDocument()

    // The generic fallback must NOT be used — it would surface the raw
    // "Statement Data" column and a "Records" heading.
    expect(screen.queryByText('Records')).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Statement Data' })).not.toBeInTheDocument()
  })

  it('renders every bank key when the file has more than one institution', () => {
    mockFile({
      accounts: {
        cba: { accounts: [cbaAccount] },
        anz: {
          accounts: [
            {
              ...cbaAccount,
              name: 'ANZ Access Advantage',
              accountHolder: 'KEN SMITH',
              institution: 'ANZ',
              statementData: { details: [] },
            },
          ],
        },
      },
    })

    render(<StatementFileViewer conversationId="conv-1" slot="statementData" onClose={() => {}} />)

    expect(screen.getByText('Smart Access')).toBeInTheDocument()
    expect(screen.getByText('ANZ Access Advantage')).toBeInTheDocument()
    expect(screen.queryByText('Records')).not.toBeInTheDocument()
  })

  it('still renders the sandbox bank_of_statements key', () => {
    mockFile({ accounts: { bank_of_statements: { accounts: [cbaAccount] } } })

    render(<StatementFileViewer conversationId="conv-1" slot="statementData" onClose={() => {}} />)

    expect(screen.getByText('Smart Access')).toBeInTheDocument()
    expect(screen.queryByText('Records')).not.toBeInTheDocument()
  })
})
