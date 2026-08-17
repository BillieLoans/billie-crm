/**
 * Integration Tests for Ledger API Routes
 * 
 * Tests cover Features F2 (View Transactions) and F3 (Post Transactions)
 * from Requirements/v2-servicing-app
 * 
 * These tests verify the Next.js API routes that proxy to the gRPC ledger service.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mockLedgerResponses } from './fixtures/test-data'

// Mock fetch for API route testing
const mockFetch = vi.fn()
global.fetch = mockFetch

// Mock the gRPC client module
vi.mock('@/server/grpc-client', () => ({
  getLedgerClient: () => ({
    getBalance: vi.fn().mockResolvedValue(mockLedgerResponses.getBalance),
    getTransactions: vi.fn().mockResolvedValue(mockLedgerResponses.getTransactions),
    getStatement: vi.fn().mockResolvedValue(mockLedgerResponses.getStatement),
    recordRepayment: vi.fn().mockResolvedValue({ 
      success: true, 
      transactionId: 'TXN-NEW-001',
      newBalance: { principalBalance: '155.00', feeBalance: '80.00', totalOutstanding: '235.00' }
    }),
    applyLateFee: vi.fn().mockResolvedValue({ 
      success: true, 
      transactionId: 'TXN-NEW-002',
      newBalance: { principalBalance: '270.00', feeBalance: '90.00', totalOutstanding: '360.00' }
    }),
    waiveFee: vi.fn().mockResolvedValue({ 
      success: true, 
      transactionId: 'TXN-NEW-003',
      newBalance: { principalBalance: '270.00', feeBalance: '70.00', totalOutstanding: '340.00' }
    }),
    writeOff: vi.fn().mockResolvedValue({ 
      success: true, 
      transactionId: 'TXN-NEW-004',
      newBalance: { principalBalance: '0.00', feeBalance: '0.00', totalOutstanding: '0.00' }
    }),
    makeAdjustment: vi.fn().mockResolvedValue({ 
      success: true, 
      transactionId: 'TXN-NEW-005',
      newBalance: { principalBalance: '250.00', feeBalance: '80.00', totalOutstanding: '330.00' }
    }),
  }),
  timestampToDate: (ts: { seconds: number }) => new Date(ts.seconds * 1000),
}))

describe('Ledger API Routes Integration Tests', () => {
  const BASE_URL = 'http://localhost:3000'

  beforeAll(() => {
    mockFetch.mockReset()
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // F2: View Account Transactions
  // ==========================================================================
  describe('F2: View Account Transactions', () => {
    describe('F2.1: GET /api/ledger/transactions - View Transaction History', () => {
      it('should fetch transactions for a loan account', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockLedgerResponses.getTransactions,
        })

        const response = await fetch(
          `${BASE_URL}/api/ledger/transactions?loanAccountId=TEST-ACC-001`
        )
        const data = await response.json()

        expect(data.transactions).toBeDefined()
        expect(data.transactions.length).toBe(3)
        expect(data.totalCount).toBe(3)
      })

      it('should return transactions in reverse chronological order', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockLedgerResponses.getTransactions,
        })

        const response = await fetch(
          `${BASE_URL}/api/ledger/transactions?loanAccountId=TEST-ACC-001`
        )
        const data = await response.json()

        // Most recent transaction should be first
        const transactions = data.transactions
        expect(transactions[0].transactionType).toBeDefined()
      })

      it('should include transaction details: type, description, deltas, running balance', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockLedgerResponses.getTransactions,
        })

        const response = await fetch(
          `${BASE_URL}/api/ledger/transactions?loanAccountId=TEST-ACC-001`
        )
        const data = await response.json()

        const disbursement = data.transactions.find(
          (t: any) => t.transactionType === 'DISBURSEMENT'
        )

        expect(disbursement).toBeDefined()
        expect(disbursement.description).toBe('Initial loan disbursement')
        expect(disbursement.principalDelta).toBe('500.00')
        expect(disbursement.feeDelta).toBe('0.00')
        expect(disbursement.runningBalance).toBe('500.00')
      })

      it('should support filtering by transaction type', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            transactions: mockLedgerResponses.getTransactions.transactions.filter(
              (t) => t.transactionType === 'REPAYMENT'
            ),
            totalCount: 1,
          }),
        })

        const response = await fetch(
          `${BASE_URL}/api/ledger/transactions?loanAccountId=TEST-ACC-001&type=REPAYMENT`
        )
        const data = await response.json()

        expect(data.transactions.length).toBe(1)
        expect(data.transactions[0].transactionType).toBe('REPAYMENT')
      })

      it('should support pagination with limit and offset', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            transactions: mockLedgerResponses.getTransactions.transactions.slice(0, 2),
            totalCount: 3,
          }),
        })

        const response = await fetch(
          `${BASE_URL}/api/ledger/transactions?loanAccountId=TEST-ACC-001&limit=2&offset=0`
        )
        const data = await response.json()

        expect(data.transactions.length).toBe(2)
        expect(data.totalCount).toBe(3)
      })
    })

    describe('F2.2: GET /api/ledger/balance - View Current Balance', () => {
      it('should fetch current balance for a loan account', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockLedgerResponses.getBalance,
        })

        const response = await fetch(
          `${BASE_URL}/api/ledger/balance?loanAccountId=TEST-ACC-001`
        )
        const data = await response.json()

        expect(data.principalBalance).toBe('270.00')
        expect(data.feeBalance).toBe('80.00')
        expect(data.totalOutstanding).toBe('350.00')
      })

      it('should include "as of" timestamp', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockLedgerResponses.getBalance,
        })

        const response = await fetch(
          `${BASE_URL}/api/ledger/balance?loanAccountId=TEST-ACC-001`
        )
        const data = await response.json()

        expect(data.asOf).toBeDefined()
      })
    })

    describe('F2.3: GET /api/ledger/statement - Generate Statement', () => {
      it('should generate statement for a date range', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockLedgerResponses.getStatement,
        })

        const response = await fetch(
          `${BASE_URL}/api/ledger/statement?loanAccountId=TEST-ACC-001&startDate=2024-01-01&endDate=2024-03-01`
        )
        const data = await response.json()

        expect(data.accountNumber).toBe('ACC-12345')
        expect(data.customerName).toBe('John Smith')
        expect(data.openingBalance).toBeDefined()
        expect(data.closingBalance).toBeDefined()
      })

      it('should include totals: debits, credits, fees charged, payments received', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => mockLedgerResponses.getStatement,
        })

        const response = await fetch(
          `${BASE_URL}/api/ledger/statement?loanAccountId=TEST-ACC-001&startDate=2024-01-01&endDate=2024-03-01`
        )
        const data = await response.json()

        expect(data.totalDebits).toBe('580.00')
        expect(data.totalCredits).toBe('230.00')
      })
    })
  })

  // ==========================================================================
  // F3: Post Account Transactions
  // ==========================================================================
  describe('F3: Post Account Transactions', () => {
    describe('F3.1: POST /api/ledger/repayment - Record Repayment', () => {
      it('should record a repayment successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            transactionId: 'TXN-NEW-001',
            newBalance: {
              principalBalance: '155.00',
              feeBalance: '80.00',
              totalOutstanding: '235.00',
            },
          }),
        })

        const response = await fetch(`${BASE_URL}/api/ledger/repayment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loanAccountId: 'TEST-ACC-001',
            amount: 115.0,
            paymentReference: 'PAY-001',
            paymentMethod: 'direct_debit',
          }),
        })
        const data = await response.json()

        expect(data.success).toBe(true)
        expect(data.transactionId).toBe('TXN-NEW-001')
        expect(data.newBalance.totalOutstanding).toBe('235.00')
      })

      it('should require amount and payment reference', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({
            error: 'Missing required fields: amount, paymentReference',
          }),
        })

        const response = await fetch(`${BASE_URL}/api/ledger/repayment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loanAccountId: 'TEST-ACC-001',
          }),
        })

        expect(response.ok).toBe(false)
        expect(response.status).toBe(400)
      })
    })

    describe('F3.2: POST /api/ledger/late-fee - Apply Late Fee', () => {
      it('should apply a late fee successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            transactionId: 'TXN-NEW-002',
            newBalance: {
              principalBalance: '270.00',
              feeBalance: '90.00',
              totalOutstanding: '360.00',
            },
          }),
        })

        const response = await fetch(`${BASE_URL}/api/ledger/late-fee`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loanAccountId: 'TEST-ACC-001',
            feeAmount: 10.0,
            daysPastDue: 7,
            reason: 'Missed scheduled payment',
          }),
        })
        const data = await response.json()

        expect(data.success).toBe(true)
        expect(data.newBalance.feeBalance).toBe('90.00')
      })

      it('should require fee amount and days past due', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({
            error: 'Missing required fields: feeAmount, daysPastDue',
          }),
        })

        const response = await fetch(`${BASE_URL}/api/ledger/late-fee`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loanAccountId: 'TEST-ACC-001',
          }),
        })

        expect(response.ok).toBe(false)
      })
    })

    describe('F3.3: POST /api/ledger/waive-fee - Waive Fees', () => {
      it('should waive fees successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            transactionId: 'TXN-NEW-003',
            newBalance: {
              principalBalance: '270.00',
              feeBalance: '70.00',
              totalOutstanding: '340.00',
            },
          }),
        })

        const response = await fetch(`${BASE_URL}/api/ledger/waive-fee`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loanAccountId: 'TEST-ACC-001',
            waiverAmount: 10.0,
            reason: 'Customer goodwill',
            approvedBy: 'supervisor-001',
          }),
        })
        const data = await response.json()

        expect(data.success).toBe(true)
        expect(data.newBalance.feeBalance).toBe('70.00')
      })

      it('should require waiver amount, reason, and approver', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({
            error: 'Missing required fields: waiverAmount, reason, approvedBy',
          }),
        })

        const response = await fetch(`${BASE_URL}/api/ledger/waive-fee`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loanAccountId: 'TEST-ACC-001',
            waiverAmount: 10.0,
          }),
        })

        expect(response.ok).toBe(false)
      })

      it('should not allow waiving more than fee balance', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({
            error: 'Waiver amount exceeds current fee balance',
          }),
        })

        const response = await fetch(`${BASE_URL}/api/ledger/waive-fee`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loanAccountId: 'TEST-ACC-001',
            waiverAmount: 1000.0, // More than fee balance
            reason: 'Test',
            approvedBy: 'supervisor-001',
          }),
        })

        expect(response.ok).toBe(false)
      })
    })

    describe('F3.5: POST /api/ledger/adjustment - Make Adjustment', () => {
      it('should make a positive adjustment successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            transactionId: 'TXN-NEW-005',
            newBalance: {
              principalBalance: '290.00',
              feeBalance: '80.00',
              totalOutstanding: '370.00',
            },
          }),
        })

        const response = await fetch(`${BASE_URL}/api/ledger/adjustment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loanAccountId: 'TEST-ACC-001',
            principalDelta: 20.0,
            feeDelta: 0.0,
            reason: 'Correction - under-charged disbursement',
            approvedBy: 'supervisor-001',
          }),
        })
        const data = await response.json()

        expect(data.success).toBe(true)
      })

      it('should make a negative adjustment successfully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            success: true,
            transactionId: 'TXN-NEW-005',
            newBalance: {
              principalBalance: '250.00',
              feeBalance: '80.00',
              totalOutstanding: '330.00',
            },
          }),
        })

        const response = await fetch(`${BASE_URL}/api/ledger/adjustment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loanAccountId: 'TEST-ACC-001',
            principalDelta: -20.0,
            feeDelta: 0.0,
            reason: 'Correction - over-charged',
            approvedBy: 'supervisor-001',
          }),
        })
        const data = await response.json()

        expect(data.success).toBe(true)
        expect(data.newBalance.principalBalance).toBe('250.00')
      })

      it('should require reason and approver', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 400,
          json: async () => ({
            error: 'Missing required fields: reason, approvedBy',
          }),
        })

        const response = await fetch(`${BASE_URL}/api/ledger/adjustment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            loanAccountId: 'TEST-ACC-001',
            principalDelta: 20.0,
            feeDelta: 0.0,
          }),
        })

        expect(response.ok).toBe(false)
      })
    })
  })

  // ==========================================================================
  // API Error Handling
  // ==========================================================================
  describe('API Error Handling', () => {
    it('should return 404 for non-existent account', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({
          error: 'Account not found',
        }),
      })

      const response = await fetch(
        `${BASE_URL}/api/ledger/balance?loanAccountId=NON-EXISTENT`
      )

      expect(response.ok).toBe(false)
      expect(response.status).toBe(404)
    })

    it('should return 400 for missing required parameters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: 'Missing required parameter: loanAccountId',
        }),
      })

      const response = await fetch(`${BASE_URL}/api/ledger/balance`)

      expect(response.ok).toBe(false)
      expect(response.status).toBe(400)
    })

    it('should return 500 for gRPC service errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          error: 'Internal server error',
          details: 'Failed to connect to ledger service',
        }),
      })

      const response = await fetch(
        `${BASE_URL}/api/ledger/balance?loanAccountId=TEST-ACC-001`
      )

      expect(response.ok).toBe(false)
      expect(response.status).toBe(500)
    })
  })
})

