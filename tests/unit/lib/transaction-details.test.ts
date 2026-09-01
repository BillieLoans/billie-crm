import { describe, test, expect } from 'vitest'
import { getTransactionDetails } from '@/lib/ledger/transaction-details'

/**
 * Base transaction shape. Individual tests override `type`/`metadata` — the
 * ledger populates a different metadata key set per transaction type.
 */
const base = {
  type: 'REPAYMENT',
  description: '',
  metadata: {} as Record<string, string>,
  notes: undefined as string | undefined,
  createdBy: '',
  createdAt: '',
}

const labels = (fields: { label: string }[]) => fields.map((f) => f.label)
const valueOf = (fields: { label: string; value: string }[], label: string) =>
  fields.find((f) => f.label === label)?.value

describe('getTransactionDetails', () => {
  describe('fee waiver', () => {
    test('surfaces the operator reason from metadata', () => {
      const fields = getTransactionDetails({
        ...base,
        type: 'FEE_WAIVER',
        description: 'Fee waiver: Goodwill - first missed payment',
        metadata: {
          reason: 'Goodwill - first missed payment',
          approved_by: 'k.wallace@billie.loans',
        },
      })

      expect(valueOf(fields, 'Reason')).toBe('Goodwill - first missed payment')
      expect(valueOf(fields, 'Waived by')).toBe('k.wallace@billie.loans')
      expect(labels(fields)).not.toContain('Approved by')
    })

    test('falls back to the description prefix when metadata has no reason', () => {
      const fields = getTransactionDetails({
        ...base,
        type: 'FEE_WAIVER',
        description: 'Fee waiver: Hardship arrangement',
      })

      expect(valueOf(fields, 'Reason')).toBe('Hardship arrangement')
    })

    test('reports the waived amount against the original fee balance', () => {
      const fields = getTransactionDetails({
        ...base,
        type: 'FEE_WAIVER',
        metadata: { waiver_total: '10.00', original_fee_balance: '25.00' },
      })

      expect(valueOf(fields, 'Waived')).toBe('$10.00 of $25.00 fee balance')
    })
  })

  describe('disbursement', () => {
    test('surfaces the operator notes and bank reference', () => {
      const fields = getTransactionDetails({
        ...base,
        type: 'DISBURSEMENT',
        metadata: {
          notes: 'Paid to nominated account after ID recheck',
          bank_reference: 'DD-20260901-001',
          payment_method: 'bank_transfer',
          attachment_location: 's3://billie-files/receipt.pdf',
        },
      })

      expect(valueOf(fields, 'Notes')).toBe('Paid to nominated account after ID recheck')
      expect(valueOf(fields, 'Bank reference')).toBe('DD-20260901-001')
      expect(valueOf(fields, 'Payment method')).toBe('Bank transfer')
      expect(valueOf(fields, 'Attachment')).toBe('s3://billie-files/receipt.pdf')
    })
  })

  describe('repayment', () => {
    test('surfaces operator notes from the transaction notes field', () => {
      const fields = getTransactionDetails({
        ...base,
        type: 'REPAYMENT',
        notes: 'Customer called to arrange early payout',
      })

      expect(valueOf(fields, 'Notes')).toBe('Customer called to arrange early payout')
    })

    test('parses the allocation the ledger stringifies as a Python dict', () => {
      const fields = getTransactionDetails({
        ...base,
        type: 'REPAYMENT',
        metadata: {
          payment_method: 'direct_debit',
          payment_reference: 'DD-20260215-001',
          allocation: "{'to_fees': '10.00', 'to_principal': '190.00', 'overpayment': '0'}",
        },
      })

      expect(valueOf(fields, 'Payment method')).toBe('Direct debit')
      expect(valueOf(fields, 'Payment reference')).toBe('DD-20260215-001')
      expect(valueOf(fields, 'Allocation')).toBe('$10.00 to fees, $190.00 to principal')
    })

    test('includes overpayment in the allocation when non-zero', () => {
      const fields = getTransactionDetails({
        ...base,
        type: 'REPAYMENT',
        metadata: {
          allocation: "{'to_fees': '0', 'to_principal': '190.00', 'overpayment': '10.00'}",
        },
      })

      expect(valueOf(fields, 'Allocation')).toBe('$190.00 to principal, $10.00 overpayment')
    })

    test('omits the allocation rather than showing an unparseable blob', () => {
      const fields = getTransactionDetails({
        ...base,
        type: 'REPAYMENT',
        metadata: { allocation: 'Decimal(10.00) to_fees' },
      })

      expect(labels(fields)).not.toContain('Allocation')
    })
  })

  describe('other transaction types', () => {
    test('reports days past due on a late fee', () => {
      const fields = getTransactionDetails({
        ...base,
        type: 'LATE_FEE',
        description: 'Late payment fee (3 days past due)',
        metadata: { days_past_due: '3' },
      })

      expect(valueOf(fields, 'Days past due')).toBe('3')
    })

    test('reports the dishonoured reference on a dishonour fee', () => {
      const fields = getTransactionDetails({
        ...base,
        type: 'DISHONOUR_FEE',
        description: 'Direct debit returned - insufficient funds',
        metadata: { dishonoured_reference: 'DD-20260215-001' },
      })

      expect(valueOf(fields, 'Reason')).toBe('Direct debit returned - insufficient funds')
      expect(valueOf(fields, 'Dishonoured reference')).toBe('DD-20260215-001')
    })

    test('reports the reason and approver on an adjustment', () => {
      const fields = getTransactionDetails({
        ...base,
        type: 'ADJUSTMENT',
        description: 'Manual adjustment: Correcting duplicate fee',
        metadata: { reason: 'Correcting duplicate fee', approved_by: 'supervisor-1' },
      })

      expect(valueOf(fields, 'Reason')).toBe('Correcting duplicate fee')
      expect(valueOf(fields, 'Adjusted by')).toBe('supervisor-1')
    })

    test('falls back to the raw description for an unmapped type', () => {
      const fields = getTransactionDetails({
        ...base,
        type: 'ESTABLISHMENT_FEE',
        description: 'Loan establishment fee',
      })

      expect(valueOf(fields, 'Description')).toBe('Loan establishment fee')
    })
  })

  describe('provenance', () => {
    test('appends who recorded the transaction and when, last', () => {
      const fields = getTransactionDetails({
        ...base,
        type: 'FEE_WAIVER',
        metadata: { reason: 'Goodwill' },
        createdBy: 'k.wallace@billie.loans',
        createdAt: '2026-09-01T04:14:00Z',
      })

      expect(labels(fields).slice(-2)).toEqual(['Waived by', 'Recorded'])
      expect(valueOf(fields, 'Waived by')).toBe('k.wallace@billie.loans')
      expect(valueOf(fields, 'Recorded')).not.toBe('')
    })

    test('accepts the proto timestamp shape the ledger route passes through', () => {
      const fields = getTransactionDetails({
        ...base,
        createdAt: { seconds: '1788220440', nanos: 0 } as unknown as string,
      })

      expect(valueOf(fields, 'Recorded')).toMatch(/2026/)
    })

    test('omits an unparseable timestamp rather than rendering Invalid Date', () => {
      const fields = getTransactionDetails({ ...base, createdAt: 'not-a-date' })

      expect(labels(fields)).not.toContain('Recorded')
    })
  })

  describe('who did it', () => {
    const ACTOR = '95979e54-7f2e-4578-a9d0-807c8951da68'
    const actors = { [ACTOR]: 'Kathryn Wallace' }

    test('labels a write-off approver as an approver — that one is a real second party', () => {
      const fields = getTransactionDetails({
        ...base,
        type: 'WRITE_OFF',
        metadata: { reason: 'Uncommercial to pursue', approved_by: ACTOR },
      })

      expect(labels(fields)).toContain('Approved by')
      expect(labels(fields)).not.toContain('Recorded by')
    })

    test('labels a repayment actor as the recorder', () => {
      const fields = getTransactionDetails({ ...base, type: 'REPAYMENT', createdBy: ACTOR })

      expect(labels(fields)).toContain('Recorded by')
    })

    test('resolves the actor id to a person', () => {
      const fields = getTransactionDetails(
        { ...base, type: 'REPAYMENT', createdBy: ACTOR },
        actors,
      )

      expect(valueOf(fields, 'Recorded by')).toBe('Kathryn Wallace')
    })

    test('falls back to the raw id when it cannot be resolved', () => {
      const fields = getTransactionDetails({ ...base, type: 'REPAYMENT', createdBy: ACTOR }, {})

      expect(valueOf(fields, 'Recorded by')).toBe(ACTOR)
    })

    test('names the automated actor readably', () => {
      const fields = getTransactionDetails({ ...base, type: 'LATE_FEE', createdBy: 'system' })

      expect(valueOf(fields, 'Recorded by')).toBe('System')
    })

    test('shows one actor line, not two, when the approver also recorded it', () => {
      const fields = getTransactionDetails(
        {
          ...base,
          type: 'FEE_WAIVER',
          metadata: { reason: 'Goodwill', approved_by: ACTOR },
          createdBy: ACTOR,
        },
        actors,
      )

      expect(labels(fields).filter((l) => l.endsWith(' by'))).toEqual(['Waived by'])
      expect(valueOf(fields, 'Waived by')).toBe('Kathryn Wallace')
    })

    test('prefers the recorded approver over a legacy system actor', () => {
      const fields = getTransactionDetails(
        {
          ...base,
          type: 'FEE_WAIVER',
          metadata: { reason: 'Goodwill', approved_by: ACTOR },
          createdBy: 'system',
        },
        actors,
      )

      expect(valueOf(fields, 'Waived by')).toBe('Kathryn Wallace')
    })
  })

  describe('empty handling', () => {
    test('drops blank metadata values', () => {
      const fields = getTransactionDetails({
        ...base,
        type: 'DISBURSEMENT',
        metadata: { notes: '', bank_reference: '   ', payment_method: 'bank_transfer' },
      })

      expect(labels(fields)).toEqual(['Payment method'])
    })

    test('returns nothing when the transaction carries no detail at all', () => {
      expect(getTransactionDetails(base)).toEqual([])
    })
  })
})
