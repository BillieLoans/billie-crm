import { describe, it, expect } from 'vitest'
import {
  RecordRepaymentSchema,
  WaiveFeeSchema,
  WriteOffLedgerSchema,
  MakeAdjustmentSchema,
  ApplyLateFeeSchema,
  ApplyDishonourFeeSchema,
  DisburseLoanSchema,
} from '@/lib/schemas/ledger'
import {
  UpdatePDRateSchema,
  PeriodClosePreviewSchema,
  PresignedUrlSchema,
  CreateExportJobSchema,
} from '@/lib/schemas/api'

// =============================================================================
// Ledger Schemas
// =============================================================================

describe('positiveDecimalString (via RecordRepaymentSchema.amount)', () => {
  const parse = (amount: string) =>
    RecordRepaymentSchema.safeParse({
      loanAccountId: 'LOAN-001',
      amount,
      paymentId: 'PAY-001',
    })

  it('accepts "100" (integer)', () => {
    expect(parse('100').success).toBe(true)
  })

  it('accepts "100.00" (two decimals)', () => {
    expect(parse('100.00').success).toBe(true)
  })

  it('accepts "0.50" (leading zero)', () => {
    expect(parse('0.50').success).toBe(true)
  })

  it('accepts "1.5" (one decimal)', () => {
    expect(parse('1.5').success).toBe(true)
  })

  it('accepts "999999.99" (large amount)', () => {
    expect(parse('999999.99').success).toBe(true)
  })

  it('rejects "" (empty)', () => {
    expect(parse('').success).toBe(false)
  })

  it('rejects "-100.00" (negative)', () => {
    expect(parse('-100.00').success).toBe(false)
  })

  it('rejects "abc" (non-numeric)', () => {
    expect(parse('abc').success).toBe(false)
  })

  it('rejects "100.001" (three decimals)', () => {
    expect(parse('100.001').success).toBe(false)
  })

  it('rejects "12.3.4" (multiple dots)', () => {
    expect(parse('12.3.4').success).toBe(false)
  })

  it('rejects " 100" (leading space)', () => {
    expect(parse(' 100').success).toBe(false)
  })

  it('rejects "100 " (trailing space)', () => {
    expect(parse('100 ').success).toBe(false)
  })
})

describe('decimalString (via MakeAdjustmentSchema.principalDelta)', () => {
  const parse = (principalDelta: string) =>
    MakeAdjustmentSchema.safeParse({
      loanAccountId: 'LOAN-001',
      principalDelta,
      feeDelta: '0',
      reason: 'Test adjustment',
    })

  it('accepts "100.00" (positive)', () => {
    expect(parse('100.00').success).toBe(true)
  })

  it('accepts "-50.00" (negative)', () => {
    expect(parse('-50.00').success).toBe(true)
  })

  it('accepts "0" (zero)', () => {
    expect(parse('0').success).toBe(true)
  })

  it('accepts "-0.01" (small negative)', () => {
    expect(parse('-0.01').success).toBe(true)
  })

  it('rejects "abc"', () => {
    expect(parse('abc').success).toBe(false)
  })

  it('rejects "100.001" (three decimals)', () => {
    expect(parse('100.001').success).toBe(false)
  })
})

describe('RecordRepaymentSchema', () => {
  const validPayload = {
    loanAccountId: 'LOAN-001',
    amount: '250.00',
    paymentId: 'PAY-001',
    paymentMethod: 'direct_debit',
    paymentReference: 'REF-123',
    expectedVersion: '1',
  }

  it('accepts a valid full payload', () => {
    const result = RecordRepaymentSchema.safeParse(validPayload)
    expect(result.success).toBe(true)
  })

  it('rejects missing loanAccountId', () => {
    const { loanAccountId: _, ...payload } = validPayload
    const result = RecordRepaymentSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })

  it('rejects missing amount', () => {
    const { amount: _, ...payload } = validPayload
    const result = RecordRepaymentSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })

  it('rejects missing paymentId', () => {
    const { paymentId: _, ...payload } = validPayload
    const result = RecordRepaymentSchema.safeParse(payload)
    expect(result.success).toBe(false)
  })

  it('accepts when optional fields are omitted', () => {
    const result = RecordRepaymentSchema.safeParse({
      loanAccountId: 'LOAN-001',
      amount: '100.00',
      paymentId: 'PAY-001',
    })
    expect(result.success).toBe(true)
  })
})

describe('WaiveFeeSchema', () => {
  it('rejects reason with 1001 chars (max 1000)', () => {
    const result = WaiveFeeSchema.safeParse({
      loanAccountId: 'LOAN-001',
      waiverAmount: '25.00',
      reason: 'a'.repeat(1001),
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty reason', () => {
    const result = WaiveFeeSchema.safeParse({
      loanAccountId: 'LOAN-001',
      waiverAmount: '25.00',
      reason: '',
    })
    expect(result.success).toBe(false)
  })
})

describe('ApplyLateFeeSchema', () => {
  it('rejects daysPastDue: -1 (min 0)', () => {
    const result = ApplyLateFeeSchema.safeParse({
      loanAccountId: 'LOAN-001',
      feeAmount: '10.00',
      daysPastDue: -1,
    })
    expect(result.success).toBe(false)
  })

  it('accepts daysPastDue: 0', () => {
    const result = ApplyLateFeeSchema.safeParse({
      loanAccountId: 'LOAN-001',
      feeAmount: '10.00',
      daysPastDue: 0,
    })
    expect(result.success).toBe(true)
  })

  it('rejects daysPastDue: 1.5 (must be int)', () => {
    const result = ApplyLateFeeSchema.safeParse({
      loanAccountId: 'LOAN-001',
      feeAmount: '10.00',
      daysPastDue: 1.5,
    })
    expect(result.success).toBe(false)
  })
})

// =============================================================================
// API Schemas
// =============================================================================

describe('UpdatePDRateSchema', () => {
  it('accepts rate: 0 (valid PD rate)', () => {
    const result = UpdatePDRateSchema.safeParse({
      bucket: 'bucket-1',
      rate: 0,
    })
    expect(result.success).toBe(true)
  })

  it('accepts rate: 1', () => {
    const result = UpdatePDRateSchema.safeParse({
      bucket: 'bucket-1',
      rate: 1,
    })
    expect(result.success).toBe(true)
  })

  it('accepts rate: 0.5', () => {
    const result = UpdatePDRateSchema.safeParse({
      bucket: 'bucket-1',
      rate: 0.5,
    })
    expect(result.success).toBe(true)
  })

  it('rejects rate: -0.1 (below 0)', () => {
    const result = UpdatePDRateSchema.safeParse({
      bucket: 'bucket-1',
      rate: -0.1,
    })
    expect(result.success).toBe(false)
  })

  it('rejects rate: 1.1 (above 1)', () => {
    const result = UpdatePDRateSchema.safeParse({
      bucket: 'bucket-1',
      rate: 1.1,
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing bucket', () => {
    const result = UpdatePDRateSchema.safeParse({
      rate: 0.5,
    })
    expect(result.success).toBe(false)
  })
})

describe('PeriodClosePreviewSchema', () => {
  it('accepts periodDate: "2024-01-31"', () => {
    const result = PeriodClosePreviewSchema.safeParse({
      periodDate: '2024-01-31',
    })
    expect(result.success).toBe(true)
  })

  it('rejects periodDate: "2024/01/31" (wrong format)', () => {
    const result = PeriodClosePreviewSchema.safeParse({
      periodDate: '2024/01/31',
    })
    expect(result.success).toBe(false)
  })

  it('rejects periodDate: "Jan 2024"', () => {
    const result = PeriodClosePreviewSchema.safeParse({
      periodDate: 'Jan 2024',
    })
    expect(result.success).toBe(false)
  })

  it('rejects periodDate: "" (empty)', () => {
    const result = PeriodClosePreviewSchema.safeParse({
      periodDate: '',
    })
    expect(result.success).toBe(false)
  })
})

describe('PresignedUrlSchema', () => {
  it('accepts contentType: "application/pdf"', () => {
    const result = PresignedUrlSchema.safeParse({
      accountNumber: 'ACC-001',
      fileName: 'document.pdf',
      contentType: 'application/pdf',
    })
    expect(result.success).toBe(true)
  })

  it('rejects contentType: "text/html" (not in allowed list)', () => {
    const result = PresignedUrlSchema.safeParse({
      accountNumber: 'ACC-001',
      fileName: 'page.html',
      contentType: 'text/html',
    })
    expect(result.success).toBe(false)
  })

  it('rejects contentType: "application/javascript"', () => {
    const result = PresignedUrlSchema.safeParse({
      accountNumber: 'ACC-001',
      fileName: 'script.js',
      contentType: 'application/javascript',
    })
    expect(result.success).toBe(false)
  })

  it('rejects fileName with 256 chars (max 255)', () => {
    const result = PresignedUrlSchema.safeParse({
      accountNumber: 'ACC-001',
      fileName: 'a'.repeat(256),
      contentType: 'application/pdf',
    })
    expect(result.success).toBe(false)
  })

  it('accepts fileName with 255 chars', () => {
    const result = PresignedUrlSchema.safeParse({
      accountNumber: 'ACC-001',
      fileName: 'a'.repeat(255),
      contentType: 'application/pdf',
    })
    expect(result.success).toBe(true)
  })
})

describe('CreateExportJobSchema', () => {
  it('rejects accountIds with 1001 items (max 1000)', () => {
    const result = CreateExportJobSchema.safeParse({
      exportType: 'ecl',
      accountIds: Array.from({ length: 1001 }, (_, i) => `ACC-${i}`),
    })
    expect(result.success).toBe(false)
  })

  it('rejects periodDate with invalid format', () => {
    const result = CreateExportJobSchema.safeParse({
      exportType: 'ecl',
      periodDate: '01-31-2024',
    })
    expect(result.success).toBe(false)
  })
})
