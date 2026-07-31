import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { RecordPaymentModal } from '@/components/LoanAccountServicing/RecordPaymentModal'
import { ApplyLateFeeModal } from '@/components/LoanAccountServicing/ApplyLateFeeModal'
import { WriteOffModal } from '@/components/LoanAccountServicing/WriteOffModal'
import { AdjustmentModal } from '@/components/LoanAccountServicing/AdjustmentModal'
import { WaiveFeeModal } from '@/components/LoanAccountServicing/WaiveFeeModal'
import { DisburseLoanModal } from '@/components/LoanAccountServicing/DisburseLoanModal'

// These modals are plain React + fetch; nothing pulls in @payloadcms/ui, but the
// balance lookups fire on mount so fetch is stubbed to a resolved empty payload.
const noop = () => {}

// ux-standards.md §1.2 (SC 1.3.1 / 4.1.2): every visible form label must resolve to
// its control, so clicking the label focuses the field and screen readers announce
// the field name. getByLabelText only matches via htmlFor/id, aria-label,
// aria-labelledby, or a wrapping <label> — exactly the associations we require.
describe('money-movement modal form labels are associated with their controls', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ feeBalance: '0', balance: '0' }),
        }),
      ),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  const simpleProps = { loanAccountId: 'la-1', onClose: noop, onSuccess: noop }

  it.each([
    ['Payment Amount *'],
    ['Payment Reference *'],
    ['Payment Method'],
  ])('RecordPaymentModal associates %s', (label) => {
    render(<RecordPaymentModal {...simpleProps} />)
    expect(screen.getByLabelText(label)).toBeDefined()
  })

  it.each([['Fee Amount *'], ['Days Past Due *'], ['Reason (Optional)']])(
    'ApplyLateFeeModal associates %s',
    (label) => {
      render(<ApplyLateFeeModal {...simpleProps} />)
      expect(screen.getByLabelText(label)).toBeDefined()
    },
  )

  it.each([
    ['Reason *'],
    ['Approved By (Manager) *'],
    ['Type "WRITE OFF" to confirm *'],
  ])('WriteOffModal associates %s', (label) => {
    render(<WriteOffModal {...simpleProps} />)
    expect(screen.getByLabelText(label)).toBeDefined()
  })

  it.each([
    ['Adjustment Type *'],
    ['Direction *'],
    ['Amount *'],
    ['Reason *'],
    ['Authorized By'],
  ])('AdjustmentModal associates %s', (label) => {
    render(<AdjustmentModal {...simpleProps} />)
    expect(screen.getByLabelText(label)).toBeDefined()
  })

  it.each([['Waiver Amount *'], ['Reason *'], ['Approved By *']])(
    'WaiveFeeModal associates %s',
    (label) => {
      render(<WaiveFeeModal {...simpleProps} />)
      expect(screen.getByLabelText(label)).toBeDefined()
    },
  )

  it.each([
    ['Disbursement Amount'],
    ['Bank Reference *'],
    ['Payment Method'],
    ['Notes'],
  ])('DisburseLoanModal associates %s', (label) => {
    render(
      <DisburseLoanModal
        loanAccountId="la-1"
        accountNumber="ACC-1"
        defaultAmount={100}
        onClose={noop}
        onSuccess={noop}
      />,
    )
    expect(screen.getByLabelText(label)).toBeDefined()
  })
})

// ux-standards.md §8.3: these six were the only modals in the app with no dialog
// semantics at all — the highest-stakes surfaces, announced to a screen reader as
// anonymous divs.
describe('money-movement modals expose dialog semantics', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ feeBalance: '0', balance: '0' }),
        }),
      ),
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  const simpleProps = { loanAccountId: 'la-1', onClose: noop, onSuccess: noop }

  const cases: [string, string, () => React.ReactElement][] = [
    ['RecordPaymentModal', 'Record Payment', () => <RecordPaymentModal {...simpleProps} />],
    ['ApplyLateFeeModal', 'Apply Late Fee', () => <ApplyLateFeeModal {...simpleProps} />],
    ['WriteOffModal', 'Write Off Account', () => <WriteOffModal {...simpleProps} />],
    ['AdjustmentModal', 'Manual Adjustment', () => <AdjustmentModal {...simpleProps} />],
    ['WaiveFeeModal', 'Waive Fee', () => <WaiveFeeModal {...simpleProps} />],
    [
      'DisburseLoanModal',
      'Disburse Loan',
      () => (
        <DisburseLoanModal
          loanAccountId="la-1"
          accountNumber="ACC-1"
          defaultAmount={100}
          onClose={noop}
          onSuccess={noop}
        />
      ),
    ],
  ]

  it.each(cases)('%s is a dialog named "%s"', (_name, title, renderFn) => {
    render(renderFn())
    expect(screen.getByRole('dialog', { name: title })).toBeDefined()
  })

  it.each(cases)('%s has a labelled close control', (_name, _title, renderFn) => {
    render(renderFn())
    expect(screen.getByRole('button', { name: 'Close' })).toBeDefined()
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<WaiveFeeModal loanAccountId="la-1" onClose={onClose} onSuccess={noop} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
