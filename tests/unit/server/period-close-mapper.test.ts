/**
 * Regression tests for src/server/period-close-mapper.ts — the gRPC → CRM
 * mapper whose casing bug produced the original BTB-68 "$NaN" symptom on the
 * period-close preview screen (totals rendered as NaN because the mapper read
 * snake_case-ish/renamed fields that the gRPC response never had).
 *
 * These tests are regression armor for the already-shipped fix (commit
 * 9df8b02), written after the fact — see commit body for why the red phase
 * is intentionally skipped here.
 */

import { describe, it, expect, vi } from 'vitest'
import type { Payload } from 'payload'
import { mapPreviewResponse, mapFinalizeResponse } from '@/server/period-close-mapper'

/** Minimal mock matching the shape mapPreviewResponse actually calls: payload.find(...). */
function mockPayload(docs: any[] = []): Payload {
  return {
    find: vi.fn().mockResolvedValue({ docs }),
  } as unknown as Payload
}

describe('mapPreviewResponse', () => {
  it('maps a full realistic camelCase gRPC preview response', async () => {
    const grpcResponse = {
      previewId: 'prev_abc123',
      periodDate: '2026-01-31',
      expiresAt: '2026-01-31T14:00:00Z',
      totalAccounts: 42,
      totalAccruedYield: '1234.56',
      totalEclAllowance: '9876.54',
      totalCarryingAmount: '500000.00',
      eclByBucket: [
        {
          bucket: 'current',
          accountCount: 30,
          totalEcl: '1000.00',
          totalCarryingAmount: '400000.00',
          averagePdRate: '0.0125',
        },
        {
          bucket: '30-59',
          accountCount: 12,
          totalEcl: '8876.54',
          totalCarryingAmount: '100000.00',
          averagePdRate: '0.085',
        },
      ],
      eclMovement: {
        priorTotalEcl: '9000.00',
        netChange: '876.54',
        changePercent: '9.74',
        byCause: [
          { cause: 'aging_migration', amount: '600.00' },
          { cause: 'new_originations', amount: '276.54' },
        ],
        byBucket: [
          { bucket: 'current', accountsEntered: 5, accountsExited: 2, netChange: '150.00' },
          { bucket: '30-59', accountsEntered: 2, accountsExited: 1, netChange: '726.54' },
        ],
      },
      reconciliation: {
        isReconciled: true,
        expectedTotal: '9876.54',
        actualTotal: '9876.54',
      },
      anomalies: [
        {
          anomalyId: 'anom_1',
          anomalyType: 'ecl_spike',
          severity: 'high',
          accountId: 'acc_1',
          accountNumber: 'LN-1001',
          description: 'ECL increased by more than 50% period over period',
          acknowledged: false,
        },
        {
          anomalyId: 'anom_2',
          anomalyType: 'pd_outlier',
          severity: 'medium',
          accountId: 'acc_2',
          accountNumber: 'LN-1002',
          description: 'PD rate outside expected range',
          acknowledged: true,
          acknowledgedBy: 'user_ops1',
          acknowledgedAt: '2026-01-31T13:00:00Z',
        },
      ],
    }

    const payload = mockPayload()
    const result = await mapPreviewResponse(grpcResponse, payload)

    expect(result.previewId).toBe('prev_abc123')
    expect(result.periodDate).toBe('2026-01-31')
    expect(result.expiresAt).toBe('2026-01-31T14:00:00Z')
    expect(result.status).toBe('ready')
    expect(result.totalAccounts).toBe(42)
    expect(result.totalAccruedYield).toBe(1234.56)
    expect(result.totalECLAllowance).toBe(9876.54)
    expect(result.totalCarryingAmount).toBe(500000.0)

    expect(result.eclByBucket).toEqual([
      { bucket: 'current', accountCount: 30, eclAmount: 1000.0, carryingAmount: 400000.0, pdRate: 0.0125 },
      { bucket: '30-59', accountCount: 12, eclAmount: 8876.54, carryingAmount: 100000.0, pdRate: 0.085 },
    ])

    expect(result.priorPeriodECL).toBe(9000.0)
    expect(result.eclChange).toBe(876.54)
    expect(result.eclChangePercent).toBe(9.74)
    expect(result.movementByCause).toEqual([
      { cause: 'aging_migration', amount: 600.0, accountCount: 0 },
      { cause: 'new_originations', amount: 276.54, accountCount: 0 },
    ])
    expect(result.movementByBucket).toEqual([
      { bucket: 'current', inCount: 5, outCount: 2, netChange: 150.0 },
      { bucket: '30-59', inCount: 2, outCount: 1, netChange: 726.54 },
    ])

    expect(result.reconciled).toBe(true)
    expect(result.reconciliationNotes).toBeUndefined()
    expect(result.journalEntries).toEqual([])

    expect(result.anomalyCount).toBe(2)
    expect(result.acknowledgedCount).toBe(1)
    expect(result.anomalies).toHaveLength(2)
    expect(result.anomalies[0]).toMatchObject({
      anomalyId: 'anom_1',
      anomalyType: 'ecl_spike',
      severity: 'high',
      acknowledged: false,
    })

    // No matching docs were returned by payload.find, so enrichment leaves
    // customerIdString undefined rather than throwing.
    expect(result.anomalies[0].customerIdString).toBeUndefined()
    expect(payload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'loan-accounts',
        where: { loanAccountId: { in: ['acc_1', 'acc_2'] } },
      }),
    )
  })

  it('defaults numeric fields to 0, reconciled to false, and anomalies to [] for an empty/missing-field response', async () => {
    // This documents the num() zero-fallback behavior: num() treats any
    // non-finite parse (missing field, wrong casing, unexpected type) as 0,
    // not NaN. That's what closed the original BTB-68 "$NaN" bug — but it is
    // also the known residual risk flagged in review: a future field-name/
    // casing drift between the gRPC proto and this mapper will silently
    // render "$0.00" instead of failing loudly, so this fixture existing at
    // all (rather than a thrown error) is the thing worth re-checking if the
    // proto contract ever changes.
    const payload = mockPayload()
    const result = await mapPreviewResponse({}, payload)

    expect(result.previewId).toBe('')
    expect(result.periodDate).toBe('')
    expect(result.expiresAt).toBe('')
    expect(result.status).toBe('ready')
    expect(result.totalAccounts).toBe(0)
    expect(result.totalAccruedYield).toBe(0)
    expect(result.totalECLAllowance).toBe(0)
    expect(result.totalCarryingAmount).toBe(0)
    expect(result.eclByBucket).toEqual([])

    // No eclMovement object at all => movement fields are undefined, not 0.
    expect(result.priorPeriodECL).toBeUndefined()
    expect(result.eclChange).toBeUndefined()
    expect(result.eclChangePercent).toBeUndefined()
    expect(result.movementByCause).toEqual([])
    expect(result.movementByBucket).toEqual([])

    expect(result.reconciled).toBe(false)
    expect(result.anomalies).toEqual([])
    expect(result.anomalyCount).toBe(0)
    expect(result.acknowledgedCount).toBe(0)
    expect(result.journalEntries).toEqual([])

    // No anomalies => no accountIds => payload.find must not be called at all.
    expect(payload.find).not.toHaveBeenCalled()
  })

  it('enriches anomalies with customerIdString when payload.find returns matching loan-account docs', async () => {
    const grpcResponse = {
      anomalies: [
        { anomalyId: 'anom_1', anomalyType: 'ecl_spike', severity: 'high', accountId: 'acc_1', description: 'x', acknowledged: false },
        { anomalyId: 'anom_2', anomalyType: 'ecl_spike', severity: 'low', accountId: 'acc_2', description: 'y', acknowledged: false },
      ],
    }
    const payload = mockPayload([
      { loanAccountId: 'acc_1', customerIdString: 'cust_100' },
      { loanAccountId: 'acc_2', customerIdString: 'cust_200' },
    ])

    const result = await mapPreviewResponse(grpcResponse, payload)

    expect(result.anomalies[0].customerIdString).toBe('cust_100')
    expect(result.anomalies[1].customerIdString).toBe('cust_200')
    expect(payload.find).toHaveBeenCalledTimes(1)
  })
})

describe('mapFinalizeResponse', () => {
  it('maps totalEclAllowance and journal entry entryId/entryType fields', () => {
    const grpcResponse = {
      success: true,
      periodDate: '2026-01-31',
      finalizedAt: '2026-01-31T15:00:00Z',
      totalAccounts: 42,
      totalEclAllowance: '9876.54',
      totalAccruedYield: '1234.56',
      journalEntries: [
        {
          entryId: 'je_1',
          entryType: 'ecl_provision',
          description: 'ECL allowance movement',
          debitAccount: 'ECL-EXPENSE',
          creditAccount: 'ECL-ALLOWANCE',
          amount: '876.54',
          createdAt: '2026-01-31T15:00:01Z',
        },
      ],
    }

    const result = mapFinalizeResponse(grpcResponse)

    expect(result.success).toBe(true)
    expect(result.periodDate).toBe('2026-01-31')
    expect(result.finalizedAt).toBe('2026-01-31T15:00:00Z')
    expect(result.totalAccounts).toBe(42)
    expect(result.totalECLAllowance).toBe(9876.54)
    expect(result.totalAccruedYield).toBe(1234.56)
    expect(result.journalEntries).toEqual([
      {
        id: 'je_1',
        type: 'ecl_provision',
        description: 'ECL allowance movement',
        debitAccount: 'ECL-EXPENSE',
        creditAccount: 'ECL-ALLOWANCE',
        amount: 876.54,
        createdAt: '2026-01-31T15:00:01Z',
      },
    ])
  })

  it('defaults to false/empty values for a missing/empty response', () => {
    const result = mapFinalizeResponse({})

    expect(result.success).toBe(false)
    expect(result.periodDate).toBe('')
    expect(result.finalizedAt).toBe('')
    expect(result.totalAccounts).toBe(0)
    expect(result.totalECLAllowance).toBe(0)
    expect(result.totalAccruedYield).toBe(0)
    expect(result.journalEntries).toEqual([])
  })
})
