import { describe, test, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { CustomerProfile } from '@/components/ServicingView/CustomerProfile'
import type { CustomerData } from '@/hooks/queries/useCustomer'

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

describe('CustomerProfile component', () => {
  afterEach(() => {
    cleanup()
  })

  test('renders customer full name', () => {
    render(<CustomerProfile customer={createMockCustomer()} />)
    expect(screen.getByText('John Smith')).toBeInTheDocument()
  })

  test('renders customer ID', () => {
    render(<CustomerProfile customer={createMockCustomer()} />)
    expect(screen.getByText('CUST-12345')).toBeInTheDocument()
  })

  test('renders email address', () => {
    render(<CustomerProfile customer={createMockCustomer()} />)
    expect(screen.getByText('john@example.com')).toBeInTheDocument()
  })

  test('renders phone number', () => {
    render(<CustomerProfile customer={createMockCustomer()} />)
    expect(screen.getByText('0412 345 678')).toBeInTheDocument()
  })

  test('renders formatted date of birth', () => {
    render(<CustomerProfile customer={createMockCustomer({ dateOfBirth: '1990-05-15' })} />)
    expect(screen.getByText('15 May 1990')).toBeInTheDocument()
  })

  test('renders address', () => {
    render(<CustomerProfile customer={createMockCustomer()} />)
    expect(screen.getByText('123 Main St, Sydney NSW 2000')).toBeInTheDocument()
  })

  test('renders initials in avatar', () => {
    render(<CustomerProfile customer={createMockCustomer()} />)
    expect(screen.getByText('JS')).toBeInTheDocument()
  })

  test('renders "Unknown" when fullName is null', () => {
    render(<CustomerProfile customer={createMockCustomer({ fullName: null })} />)
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  test('renders em dash when email is null', () => {
    render(<CustomerProfile customer={createMockCustomer({ emailAddress: null })} />)
    const values = screen.getAllByText('—')
    expect(values.length).toBeGreaterThanOrEqual(1)
  })

  test('has correct test id', () => {
    render(<CustomerProfile customer={createMockCustomer()} />)
    expect(screen.getByTestId('customer-profile')).toBeInTheDocument()
  })

  test('formats address from parts when fullAddress is missing', () => {
    const customer = createMockCustomer({
      residentialAddress: {
        fullAddress: null,
        street: '45 Test Rd',
        suburb: 'Melbourne',
        state: 'VIC',
        postcode: '3000',
      },
    })
    render(<CustomerProfile customer={customer} />)
    expect(screen.getByText('45 Test Rd, Melbourne, VIC 3000')).toBeInTheDocument()
  })

  test('renders em dash when address is null', () => {
    const customer = createMockCustomer({ residentialAddress: null })
    render(<CustomerProfile customer={customer} />)
    // Should have multiple em dashes (for missing fields)
    const values = screen.getAllByText('—')
    expect(values.length).toBeGreaterThanOrEqual(1)
  })

  test('formats partial address with only suburb and state', () => {
    const customer = createMockCustomer({
      residentialAddress: {
        fullAddress: null,
        street: null,
        suburb: 'Perth',
        state: 'WA',
        postcode: null,
      },
    })
    render(<CustomerProfile customer={customer} />)
    expect(screen.getByText('Perth, WA')).toBeInTheDocument()
  })
})

describe('CustomerProfile identity badges', () => {
  afterEach(() => {
    cleanup()
  })

  test('renders Verified badge when identityVerified is true', () => {
    render(<CustomerProfile customer={createMockCustomer({ identityVerified: true })} />)
    expect(screen.getByText('✓ Verified')).toBeInTheDocument()
  })

  test('renders Staff badge when staffFlag is true', () => {
    render(<CustomerProfile customer={createMockCustomer({ staffFlag: true })} />)
    expect(screen.getByText('Staff')).toBeInTheDocument()
  })

  test('renders Investor badge when investorFlag is true', () => {
    render(<CustomerProfile customer={createMockCustomer({ investorFlag: true })} />)
    expect(screen.getByText('Investor')).toBeInTheDocument()
  })

  test('renders Founder badge when founderFlag is true', () => {
    render(<CustomerProfile customer={createMockCustomer({ founderFlag: true })} />)
    expect(screen.getByText('Founder')).toBeInTheDocument()
  })

  test('renders Vulnerable badge when vulnerableFlag is true', () => {
    render(<CustomerProfile customer={createMockCustomer({ vulnerableFlag: true })} />)
    expect(screen.getByTestId('vulnerable-badge')).toBeInTheDocument()
    expect(screen.getByText('⚠ Vulnerable')).toBeInTheDocument()
  })

  test('does not render badges section when no flags are set', () => {
    const customer = createMockCustomer({
      identityVerified: false,
      staffFlag: false,
      investorFlag: false,
      founderFlag: false,
      vulnerableFlag: false,
    })
    render(<CustomerProfile customer={customer} />)
    expect(screen.queryByText('✓ Verified')).not.toBeInTheDocument()
    expect(screen.queryByText('Staff')).not.toBeInTheDocument()
  })

  test('renders multiple badges when multiple flags are true', () => {
    const customer = createMockCustomer({
      identityVerified: true,
      staffFlag: true,
      vulnerableFlag: true,
    })
    render(<CustomerProfile customer={customer} />)
    expect(screen.getByText('✓ Verified')).toBeInTheDocument()
    expect(screen.getByText('Staff')).toBeInTheDocument()
    expect(screen.getByText('⚠ Vulnerable')).toBeInTheDocument()
  })
})

describe('CustomerProfile re-application block strip (BTB-135)', () => {
  afterEach(cleanup)

  test('hidden when there is no block', () => {
    render(<CustomerProfile customer={createMockCustomer()} />)
    expect(screen.queryByTestId('reapplication-block-strip')).not.toBeInTheDocument()
  })

  test('shows an active dated block with reason, window and source application', () => {
    const customer = createMockCustomer({
      reapplicationBlock: {
        reason: 'ID_VERIFICATION',
        blockedUntil: '2099-12-10T01:02:21+00:00',
        blockedAt: '2026-06-10T07:08:40+00:00',
        applicationNumber: 'A3CD3461-11F',
      },
    })
    render(<CustomerProfile customer={customer} />)
    const strip = screen.getByTestId('reapplication-block-strip')
    expect(strip).toHaveTextContent('Re-application blocked — ID verification')
    expect(strip).toHaveTextContent('until 10 December 2099')
    expect(strip).toHaveTextContent('from A3CD3461-11F')
  })

  test('permanent block (null blockedUntil) stays visible', () => {
    const customer = createMockCustomer({
      reapplicationBlock: { reason: 'PEP', blockedUntil: null, blockedAt: null, applicationNumber: null },
    })
    render(<CustomerProfile customer={customer} />)
    expect(screen.getByTestId('reapplication-block-strip')).toHaveTextContent('permanent')
  })

  test('expired block is hidden', () => {
    const customer = createMockCustomer({
      reapplicationBlock: {
        reason: 'SERVICEABILITY',
        blockedUntil: '2020-01-01T00:00:00+00:00',
        blockedAt: null,
        applicationNumber: null,
      },
    })
    render(<CustomerProfile customer={customer} />)
    expect(screen.queryByTestId('reapplication-block-strip')).not.toBeInTheDocument()
  })
})

describe('CustomerProfile identity verification section (PR #67)', () => {
  afterEach(cleanup)

  test('section renders in fixed position with em dashes before any verification', () => {
    render(<CustomerProfile customer={createMockCustomer()} />)
    const section = screen.getByTestId('identity-verification-section')
    expect(section).toHaveTextContent('Identity verification')
    expect(section).toHaveTextContent('Status')
    expect(section).toHaveTextContent('Checked')
    expect(section).toHaveTextContent('Reference')
    expect(section).toHaveTextContent('Report')
    expect(screen.queryByTestId('view-identity-report')).not.toBeInTheDocument()
  })

  test('shows passed result with provider, reference and report links', () => {
    const customer = createMockCustomer({
      identityVerification: {
        overallResult: 'Passed',
        provider: 'IDMatrix',
        providerReference: '260610-52BC8-A4A67',
        labRequestId: '468881',
        checkedAt: '2026-06-10T07:32:35+00:00',
        reportArchived: true,
        archivedAt: '2026-06-10T07:35:12+00:00',
      },
    })
    render(<CustomerProfile customer={customer} />)
    expect(screen.getByText('✓ Passed · IDMatrix')).toBeInTheDocument()
    expect(screen.getByText('260610-52BC8-A4A67')).toBeInTheDocument()
    const view = screen.getByTestId('view-identity-report')
    expect(view).toHaveAttribute('href', '/api/customer/CUST-12345/identity-report?artifact=report')
    expect(view).toHaveAttribute('target', '_blank')
    expect(screen.getByTestId('download-identity-raw')).toHaveAttribute(
      'href',
      '/api/customer/CUST-12345/identity-report?artifact=raw&disposition=attachment',
    )
  })

  test('failed result renders with cross marker', () => {
    const customer = createMockCustomer({
      identityVerification: {
        overallResult: 'Failed',
        provider: 'IDMatrix',
        reportArchived: false,
      },
    })
    render(<CustomerProfile customer={customer} />)
    expect(screen.getByText('✗ Failed · IDMatrix')).toBeInTheDocument()
    // Report not archived → no links
    expect(screen.queryByTestId('view-identity-report')).not.toBeInTheDocument()
  })

  test('verification result without archived report shows result but no links', () => {
    const customer = createMockCustomer({
      identityVerification: {
        overallResult: 'Passed',
        provider: 'IDMatrix',
        checkedAt: '2026-06-10T07:32:35+00:00',
        reportArchived: false,
      },
    })
    render(<CustomerProfile customer={customer} />)
    expect(screen.getByText('✓ Passed · IDMatrix')).toBeInTheDocument()
    expect(screen.queryByTestId('view-identity-report')).not.toBeInTheDocument()
    expect(screen.queryByTestId('download-identity-raw')).not.toBeInTheDocument()
  })
})
