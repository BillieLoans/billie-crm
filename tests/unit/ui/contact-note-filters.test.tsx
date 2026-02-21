import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ContactNoteFilters } from '@/components/ServicingView/ContactNotes/ContactNoteFilters'
import type { LoanAccountData } from '@/hooks/queries/useCustomer'

const makeAccount = (id: string, loanAccountId: string, accountNumber: string): LoanAccountData => ({
  id,
  loanAccountId,
  accountNumber,
  accountStatus: 'active',
  loanTerms: null,
  balances: null,
  liveBalance: null,
  lastPayment: null,
  repaymentSchedule: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  signedLoanAgreementUrl: null,
})

// id is the Payload document ID; loanAccountId is the business key — these must be distinct
const ACCOUNT_A = makeAccount('payload-id-1', 'la-001', 'ACC-001')
const ACCOUNT_B = makeAccount('payload-id-2', 'la-002', 'ACC-002')

describe('ContactNoteFilters', () => {
  const defaultProps = {
    typeFilter: null,
    accountFilter: null,
    accounts: [],
    onTypeChange: vi.fn(),
    onAccountChange: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders type dropdown with "All Types" option', () => {
    render(<ContactNoteFilters {...defaultProps} />)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.getByText('All Types')).toBeInTheDocument()
  })

  it('renders all 11 note type labels in the type dropdown', () => {
    render(<ContactNoteFilters {...defaultProps} />)
    expect(screen.getByText('Inbound Call')).toBeInTheDocument()
    expect(screen.getByText('Outbound Call')).toBeInTheDocument()
    expect(screen.getByText('Email Received')).toBeInTheDocument()
    expect(screen.getByText('Email Sent')).toBeInTheDocument()
    expect(screen.getByText('SMS')).toBeInTheDocument()
    expect(screen.getByText('General Enquiry')).toBeInTheDocument()
    expect(screen.getByText('Complaint')).toBeInTheDocument()
    expect(screen.getByText('Escalation')).toBeInTheDocument()
    expect(screen.getByText('Internal Note')).toBeInTheDocument()
    expect(screen.getByText('Account Update')).toBeInTheDocument()
    expect(screen.getByText('Collections Activity')).toBeInTheDocument()
  })

  it('does not render account dropdown when fewer than 2 accounts', () => {
    render(<ContactNoteFilters {...defaultProps} accounts={[ACCOUNT_A]} />)
    const selects = screen.getAllByRole('combobox')
    expect(selects).toHaveLength(1)
  })

  it('renders account dropdown when 2 or more accounts', () => {
    render(<ContactNoteFilters {...defaultProps} accounts={[ACCOUNT_A, ACCOUNT_B]} />)
    const selects = screen.getAllByRole('combobox')
    expect(selects).toHaveLength(2)
  })

  it('account dropdown includes "General (no account)" option', () => {
    render(<ContactNoteFilters {...defaultProps} accounts={[ACCOUNT_A, ACCOUNT_B]} />)
    expect(screen.getByText('General (no account)')).toBeInTheDocument()
  })

  it('calls onTypeChange with the selected value when a type is chosen', () => {
    const onTypeChange = vi.fn()
    render(<ContactNoteFilters {...defaultProps} onTypeChange={onTypeChange} />)
    const typeSelect = screen.getByTestId('note-type-filter')
    fireEvent.change(typeSelect, { target: { value: 'complaint' } })
    expect(onTypeChange).toHaveBeenCalledWith('complaint')
  })

  it('calls onTypeChange with null when "All Types" is selected', () => {
    const onTypeChange = vi.fn()
    render(<ContactNoteFilters {...defaultProps} typeFilter="complaint" onTypeChange={onTypeChange} />)
    const typeSelect = screen.getByTestId('note-type-filter')
    fireEvent.change(typeSelect, { target: { value: '' } })
    expect(onTypeChange).toHaveBeenCalledWith(null)
  })

  it('calls onAccountChange with the Payload document ID when an account is selected', () => {
    const onAccountChange = vi.fn()
    render(
      <ContactNoteFilters
        {...defaultProps}
        accounts={[ACCOUNT_A, ACCOUNT_B]}
        onAccountChange={onAccountChange}
      />,
    )
    const accountSelect = screen.getByTestId('account-filter')
    // Must use the Payload document ID (payload-id-1), NOT the business key (la-001)
    fireEvent.change(accountSelect, { target: { value: 'payload-id-1' } })
    expect(onAccountChange).toHaveBeenCalledWith('payload-id-1')
  })

  it('calls onAccountChange with null when "All Accounts" is selected', () => {
    const onAccountChange = vi.fn()
    render(
      <ContactNoteFilters
        {...defaultProps}
        accounts={[ACCOUNT_A, ACCOUNT_B]}
        accountFilter="payload-id-1"
        onAccountChange={onAccountChange}
      />,
    )
    const accountSelect = screen.getByTestId('account-filter')
    fireEvent.change(accountSelect, { target: { value: '' } })
    expect(onAccountChange).toHaveBeenCalledWith(null)
  })

  it('calls onAccountChange with "none" when "General (no account)" is selected', () => {
    const onAccountChange = vi.fn()
    render(
      <ContactNoteFilters
        {...defaultProps}
        accounts={[ACCOUNT_A, ACCOUNT_B]}
        onAccountChange={onAccountChange}
      />,
    )
    const accountSelect = screen.getByTestId('account-filter')
    fireEvent.change(accountSelect, { target: { value: 'none' } })
    expect(onAccountChange).toHaveBeenCalledWith('none')
  })
})
