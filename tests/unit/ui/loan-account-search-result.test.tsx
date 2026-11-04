import { describe, test, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { LoanAccountSearchResult } from '@/components/ui/CommandPalette/LoanAccountSearchResult'
import { Command } from 'cmdk'

// Wrap component in Command context for cmdk
const CommandWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <Command>
      <Command.List>{children}</Command.List>
    </Command>
  )
}

describe('LoanAccountSearchResult component', () => {
  const mockAccount = {
    id: 'acc-1',
    loanAccountId: 'LA-12345',
    accountNumber: 'ACC-67890',
    customerName: 'John Smith',
    accountStatus: 'active' as const,
    totalOutstanding: 1234.56,
  }

  const createProps = (overrides = {}) => ({
    account: { ...mockAccount, ...overrides },
    onSelect: vi.fn(),
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  test('renders account number', () => {
    const props = createProps()
    render(
      <CommandWrapper>
        <LoanAccountSearchResult {...props} />
      </CommandWrapper>
    )

    expect(screen.getByText('ACC-67890')).toBeInTheDocument()
  })

  test('renders customer name', () => {
    const props = createProps()
    render(
      <CommandWrapper>
        <LoanAccountSearchResult {...props} />
      </CommandWrapper>
    )

    expect(screen.getByText('John Smith')).toBeInTheDocument()
  })

  test('renders formatted balance in AUD', () => {
    const props = createProps({ totalOutstanding: 1234.56 })
    render(
      <CommandWrapper>
        <LoanAccountSearchResult {...props} />
      </CommandWrapper>
    )

    // Check for AUD currency format
    expect(screen.getByText('$1,234.56')).toBeInTheDocument()
  })

  test('renders active status badge', () => {
    const props = createProps({ accountStatus: 'active' })
    render(
      <CommandWrapper>
        <LoanAccountSearchResult {...props} />
      </CommandWrapper>
    )

    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  test('renders paid off status badge', () => {
    const props = createProps({ accountStatus: 'paid_off' })
    render(
      <CommandWrapper>
        <LoanAccountSearchResult {...props} />
      </CommandWrapper>
    )

    expect(screen.getByText('Paid Off')).toBeInTheDocument()
  })

  test('renders in arrears status badge', () => {
    const props = createProps({ accountStatus: 'in_arrears' })
    render(
      <CommandWrapper>
        <LoanAccountSearchResult {...props} />
      </CommandWrapper>
    )

    expect(screen.getByText('In Arrears')).toBeInTheDocument()
  })

  test('renders written off status badge', () => {
    const props = createProps({ accountStatus: 'written_off' })
    render(
      <CommandWrapper>
        <LoanAccountSearchResult {...props} />
      </CommandWrapper>
    )

    expect(screen.getByText('Written Off')).toBeInTheDocument()
  })

  test('renders "Unknown Customer" when customerName is null', () => {
    const props = createProps({ customerName: null })
    render(
      <CommandWrapper>
        <LoanAccountSearchResult {...props} />
      </CommandWrapper>
    )

    expect(screen.getByText('Unknown Customer')).toBeInTheDocument()
  })

  test('has correct test id', () => {
    const props = createProps()
    render(
      <CommandWrapper>
        <LoanAccountSearchResult {...props} />
      </CommandWrapper>
    )

    expect(screen.getByTestId('account-result-LA-12345')).toBeInTheDocument()
  })

  test('renders credit card icon', () => {
    const props = createProps()
    const { container } = render(
      <CommandWrapper>
        <LoanAccountSearchResult {...props} />
      </CommandWrapper>
    )

    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
  })

  test('formats zero balance correctly', () => {
    const props = createProps({ totalOutstanding: 0 })
    render(
      <CommandWrapper>
        <LoanAccountSearchResult {...props} />
      </CommandWrapper>
    )

    expect(screen.getByText('$0.00')).toBeInTheDocument()
  })

  test('labels a cancelled loan "Cancelled" in a neutral badge, not as Active (BTB-517)', () => {
    const props = createProps({ accountStatus: 'cancelled' as const, totalOutstanding: 0 })
    render(
      <CommandWrapper>
        <LoanAccountSearchResult {...props} />
      </CommandWrapper>,
    )
    const badge = screen.getByText('Cancelled')
    expect(badge.className).toMatch(/badgeCancelled/)
    expect(screen.queryByText('Active')).toBeNull()
  })
})
