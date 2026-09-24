import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AlsoSeen, IdStatusChip, TierBadge } from '@/components/ServicingView/ContactProvenance'
import { CustomerProfile } from '@/components/ServicingView/CustomerProfile'
import type { CustomerData } from '@/hooks/queries/useCustomer'

const BASE: CustomerData = {
  id: 'pl-1',
  customerId: '23D47AB2',
  fullName: 'Rohan Sharp',
  firstName: 'Rohan',
  lastName: 'Sharp',
  preferredName: null,
  emailAddress: 'rohansharp+6@gmail.com',
  mobilePhoneNumber: '0412345678',
  dateOfBirth: null,
  identityVerified: true,
  staffFlag: false,
  investorFlag: false,
  founderFlag: false,
  vulnerableFlag: false,
  residentialAddress: null,
}

const WITH_PROVENANCE: CustomerData = {
  ...BASE,
  canonicalId: '23D47AB2',
  customerIdStatus: 'ADMITTED',
  emailTier: 'BOUND',
  emailSource: 'ZITADEL_LOGIN',
  emailVerifiedAt: '2026-09-23T13:15:00Z',
  mobilePhoneTier: 'VERIFIED',
  mobilePhoneSource: 'OTP_SMS',
  mobilePhoneVerifiedAt: '2026-09-23T13:15:00Z',
  contactsChangedBy: 'reconciliation',
  contactsChangedAt: '2026-09-23T13:15:00Z',
  contacts: [
    {
      contact_type: 'EMAIL',
      value: 'rohansharp+6@gmail.com',
      tier: 'BOUND',
      source: 'ZITADEL_LOGIN',
      is_primary: true,
      last_seen_at: '2026-09-23T13:15:00Z',
      origin_customer_id: '23D47AB2',
    },
    {
      contact_type: 'EMAIL',
      value: 'rohan.sharp@example.com',
      tier: 'ASSERTED',
      source: 'CHAT_ASSERTED',
      is_primary: false,
      last_seen_at: '2026-09-11T00:00:00Z',
      origin_customer_id: '258DE915',
    },
    {
      contact_type: 'MOBILE',
      value: '0412345678',
      tier: 'VERIFIED',
      source: 'OTP_SMS',
      is_primary: true,
      last_seen_at: '2026-09-23T13:15:00Z',
    },
  ],
}

describe('TierBadge', () => {
  it('renders the tier label with its meaning available to assistive tech', () => {
    render(
      <TierBadge
        tier="BOUND"
        source="ZITADEL_LOGIN"
        verifiedAt="2026-09-23T13:15:00Z"
        contactLabel="Email"
      />,
    )
    const badge = screen.getByTestId('tier-badge-email')
    expect(badge).toHaveTextContent('Login')
    // The visually hidden description carries source and date — meaning is
    // not conveyed by colour alone (WCAG 1.4.1).
    expect(badge).toHaveTextContent('portal login')
    expect(badge).toHaveTextContent('verified 23 September 2026')
    expect(badge.getAttribute('title')).toContain('Login · portal login')
  })

  it('renders nothing for a legacy row without a tier', () => {
    const { container } = render(<TierBadge tier={null} contactLabel="Mobile" />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('AlsoSeen', () => {
  it('discloses the non-primary values with their provenance', () => {
    render(<AlsoSeen contacts={WITH_PROVENANCE.contacts} type="EMAIL" customerId="23D47AB2" />)
    const toggle = screen.getByRole('button', { name: /Also seen \(1\)/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('rohan.sharp@example.com')).not.toBeInTheDocument()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('rohan.sharp@example.com')).toBeInTheDocument()
    const panel = screen.getByTestId('also-seen-email')
    expect(panel).toHaveTextContent('Unverified')
    expect(panel).toHaveTextContent('typed in chat')
    expect(panel).toHaveTextContent('last seen 11 September 2026')
    expect(panel).toHaveTextContent('under 258DE915')
  })

  it('renders nothing when every value of the type is the primary', () => {
    const { container } = render(
      <AlsoSeen contacts={WITH_PROVENANCE.contacts} type="MOBILE" customerId="23D47AB2" />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})

describe('IdStatusChip', () => {
  it('shows Linked with a link to the canonical when the id is an alias', () => {
    render(<IdStatusChip customerId="258DE915" customerIdStatus="LINKED" canonicalId="23D47AB2" />)
    const chip = screen.getByTestId('customer-id-status')
    expect(chip).toHaveTextContent('Linked → 23D47AB2')
    expect(screen.getByRole('link', { name: '23D47AB2' })).toHaveAttribute(
      'href',
      '/admin/servicing/23D47AB2',
    )
  })

  it('shows the plain status when the customer is its own canonical', () => {
    render(
      <IdStatusChip customerId="23D47AB2" customerIdStatus="ADMITTED" canonicalId="23D47AB2" />,
    )
    expect(screen.getByTestId('customer-id-status')).toHaveTextContent(/^Admitted$/)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('renders nothing without a status', () => {
    const { container } = render(<IdStatusChip customerId="X" customerIdStatus={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('CustomerProfile with provenance', () => {
  it('shows tier badges, the also-seen disclosure and the update footer', () => {
    render(<CustomerProfile customer={WITH_PROVENANCE} />)
    expect(screen.getByTestId('tier-badge-email')).toHaveTextContent('Login')
    expect(screen.getByTestId('tier-badge-mobile')).toHaveTextContent('Verified')
    expect(screen.getByRole('button', { name: /Also seen \(1\)/ })).toBeInTheDocument()
    expect(screen.getByTestId('provenance-footer')).toHaveTextContent(
      'updated by reconciliation on 23 September 2026',
    )
  })

  it('renders a legacy customer exactly as before — no badges, no disclosure, no footer', () => {
    render(<CustomerProfile customer={BASE} />)
    expect(screen.getByText('rohansharp+6@gmail.com')).toBeInTheDocument()
    expect(screen.queryByTestId('tier-badge-email')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tier-badge-mobile')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Also seen/ })).not.toBeInTheDocument()
    expect(screen.queryByTestId('provenance-footer')).not.toBeInTheDocument()
  })
})
