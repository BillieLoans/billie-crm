import { describe, test, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { CustomerHeader } from '@/components/ServicingView/CustomerHeader'
import type { CustomerData } from '@/hooks/queries/useCustomer'

// CustomerHeader renders NotificationStatusPill, which uses a React Query hook.
function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

const createMockCustomer = (overrides: Partial<CustomerData> = {}): CustomerData => ({
  id: 'cust-1',
  customerId: 'CUST-12345',
  fullName: 'John Smith',
  firstName: 'John',
  lastName: 'Smith',
  preferredName: null,
  emailAddress: 'john@example.com',
  mobilePhoneNumber: '0412 345 678',
  dateOfBirth: '1990-05-15',
  identityVerified: true,
  staffFlag: false,
  investorFlag: false,
  founderFlag: false,
  vulnerableFlag: false,
  residentialAddress: {
    fullAddress: '123 Main St, Sydney NSW 2000',
    street: '123 Main St',
    suburb: 'Sydney',
    state: 'NSW',
    postcode: '2000',
  },
  loanAccounts: [],
  ...overrides,
})

const renderHeader = (customer: CustomerData) =>
  render(<CustomerHeader customer={customer} />, { wrapper: createWrapper() })

/** The identity-verification rows live in the "More ▼" expand. */
const expand = () => fireEvent.click(screen.getByRole('button', { name: /More/ }))

describe('CustomerHeader identity verification (PR #67)', () => {
  afterEach(cleanup)

  test('identity rows are in the expand, not the collapsed header', () => {
    renderHeader(createMockCustomer())
    expect(screen.queryByTestId('identity-verification')).not.toBeInTheDocument()
    expand()
    expect(screen.getByTestId('identity-verification')).toBeInTheDocument()
  })

  test('renders fixed em-dash rows before any verification', () => {
    renderHeader(createMockCustomer())
    expand()
    const section = screen.getByTestId('identity-verification')
    expect(section).toHaveTextContent('Identity check')
    expect(screen.getByText('Reference')).toBeInTheDocument()
    expect(screen.getByText('Report')).toBeInTheDocument()
    expect(screen.queryByTestId('view-identity-report')).not.toBeInTheDocument()
  })

  test('shows passed result with provider, reference and report links', () => {
    renderHeader(
      createMockCustomer({
        identityVerification: {
          overallResult: 'Passed',
          provider: 'IDMatrix',
          providerReference: '260610-52BC8-A4A67',
          labRequestId: '468881',
          checkedAt: '2026-06-10T07:32:35+00:00',
          reportArchived: true,
          archivedAt: '2026-06-10T07:35:12+00:00',
        },
      }),
    )
    expand()
    expect(screen.getByText('✓ Passed · IDMatrix')).toBeInTheDocument()
    expect(screen.getByText('260610-52BC8-A4A67')).toBeInTheDocument()
    const view = screen.getByTestId('view-identity-report')
    expect(view).toHaveAttribute(
      'href',
      '/api/customer/CUST-12345/identity-report?artifact=report',
    )
    expect(view).toHaveAttribute('target', '_blank')
    expect(screen.getByTestId('download-identity-raw')).toHaveAttribute(
      'href',
      '/api/customer/CUST-12345/identity-report?artifact=raw&disposition=attachment',
    )
  })

  test('failed result renders with cross marker and no report links', () => {
    renderHeader(
      createMockCustomer({
        identityVerification: { overallResult: 'Failed', provider: 'IDMatrix', reportArchived: false },
      }),
    )
    expand()
    expect(screen.getByText('✗ Failed · IDMatrix')).toBeInTheDocument()
    expect(screen.queryByTestId('view-identity-report')).not.toBeInTheDocument()
  })

  test('LAB API v1: verification number, PEP / sanctions rows and screening report link', () => {
    renderHeader(
      createMockCustomer({
        identityVerification: {
          overallResult: 'refer',
          provider: 'IDMatrix',
          providerReference: '260212-E3106-FD08B',
          labRequestId: '9c63b029-d3a9-4d0c-90d8-fdcca3aad5de',
          verificationNumber: 'V60000296',
          identityOutcome: 'pass',
          screeningOutcome: 'refer',
          pepResult: 'no_match',
          sanctionsResult: 'match',
          checkedAt: '2026-09-11T05:13:09+00:00',
          reportArchived: true,
        },
      }),
    )
    expand()
    expect(screen.getByText('! refer · IDMatrix')).toBeInTheDocument()
    expect(screen.getByTestId('identity-verification-number')).toHaveTextContent('V60000296')
    const pep = screen.getByTestId('identity-pep')
    expect(pep).toHaveTextContent('no match')
    expect(pep.querySelector('[class*="idvPass"]')).not.toBeNull()
    const sanctions = screen.getByTestId('identity-sanctions')
    expect(sanctions).toHaveTextContent('match')
    expect(sanctions.querySelector('[class*="idvFail"]')).not.toBeNull()
    expect(screen.getByTestId('view-screening-report')).toHaveAttribute(
      'href',
      '/api/customer/CUST-12345/identity-report?artifact=screening',
    )
  })

  test('LAB API v1 rows fall back to em-dashes without the v1 fields', () => {
    renderHeader(
      createMockCustomer({
        identityVerification: { overallResult: 'Passed', provider: 'IDMatrix', reportArchived: false },
      }),
    )
    expand()
    expect(screen.getByTestId('identity-verification-number')).toHaveTextContent('—')
    expect(screen.getByTestId('identity-pep')).toHaveTextContent('—')
    expect(screen.getByTestId('identity-sanctions')).toHaveTextContent('—')
    expect(screen.queryByTestId('view-screening-report')).not.toBeInTheDocument()
  })

  test('verified result without archived report shows result but no links', () => {
    renderHeader(
      createMockCustomer({
        identityVerification: {
          overallResult: 'Passed',
          provider: 'IDMatrix',
          checkedAt: '2026-06-10T07:32:35+00:00',
          reportArchived: false,
        },
      }),
    )
    expand()
    expect(screen.getByText('✓ Passed · IDMatrix')).toBeInTheDocument()
    expect(screen.queryByTestId('view-identity-report')).not.toBeInTheDocument()
    expect(screen.queryByTestId('download-identity-raw')).not.toBeInTheDocument()
  })
})
