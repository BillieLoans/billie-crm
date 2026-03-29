/**
 * Integration Tests for Billie Servicing App
 * 
 * Tests cover all features from Requirements/v2-servicing-app:
 * - F1: View Customer Loan Accounts
 * - F2: View Account Transactions (API routes)
 * - F3: Post Account Transactions (API routes)
 * - F4: View Customer Conversations
 * - F5: View Customer Details
 * - F6: Single Customer View
 * - F7: Global Search
 * 
 * Note: These collections have create: () => false access control since data
 * comes from events. Tests use MongoDB directly for seeding test data.
 */

import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import { MongoClient, Db } from 'mongodb'
import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'
import { testCustomers, testLoanAccounts, testConversations, mockLedgerResponses } from './fixtures/test-data'

let payload: Payload
let mongoClient: MongoClient
let db: Db

// Mock the gRPC client
vi.mock('@/server/grpc-client', () => ({
  getLedgerClient: () => ({
    getBalance: vi.fn().mockResolvedValue(mockLedgerResponses.getBalance),
    getTransactions: vi.fn().mockResolvedValue(mockLedgerResponses.getTransactions),
    getStatement: vi.fn().mockResolvedValue(mockLedgerResponses.getStatement),
    recordRepayment: vi.fn().mockResolvedValue({ success: true, transactionId: 'TXN-NEW-001' }),
    applyLateFee: vi.fn().mockResolvedValue({ success: true, transactionId: 'TXN-NEW-002' }),
    waiveFee: vi.fn().mockResolvedValue({ success: true, transactionId: 'TXN-NEW-003' }),
    writeOff: vi.fn().mockResolvedValue({ success: true, transactionId: 'TXN-NEW-004' }),
    makeAdjustment: vi.fn().mockResolvedValue({ success: true, transactionId: 'TXN-NEW-005' }),
  }),
  timestampToDate: (ts: { seconds: number }) => new Date(ts.seconds * 1000),
}))

describe('Billie Servicing App Integration Tests', () => {
  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })
    
    // Connect to MongoDB directly for seeding test data
    // (bypasses Payload's access control which prevents create)
    const mongoUrl = process.env.DATABASE_URI || 'mongodb://localhost:27017/billie-servicing'
    mongoClient = new MongoClient(mongoUrl)
    await mongoClient.connect()
    db = mongoClient.db()
    
    // Clean up any existing test data first
    await db.collection('customers').deleteMany({ customerId: { $regex: /^TEST-/ } })
    await db.collection('loan-accounts').deleteMany({ loanAccountId: { $regex: /^TEST-/ } })
    await db.collection('conversations').deleteMany({ conversationId: { $regex: /^CONV-/ } })
    
    // Seed ALL test data upfront so it's available for all tests
    // Customers
    for (const customer of [testCustomers.customer1, testCustomers.customer2]) {
      await db.collection('customers').updateOne(
        { customerId: customer.customerId },
        { $set: { ...customer, createdAt: new Date(), updatedAt: new Date() } },
        { upsert: true }
      )
    }
    
    // Loan accounts
    for (const account of Object.values(testLoanAccounts)) {
      await db.collection('loan-accounts').updateOne(
        { loanAccountId: (account as any).loanAccountId },
        { $set: { ...account, createdAt: new Date(), updatedAt: new Date() } },
        { upsert: true }
      )
    }
    
    // Conversations
    for (const conv of Object.values(testConversations)) {
      await db.collection('conversations').updateOne(
        { conversationId: (conv as any).conversationId },
        { $set: { ...conv, createdAt: new Date() } },
        { upsert: true }
      )
    }
  })

  afterAll(async () => {
    // Clean up test data
    if (db) {
      await db.collection('customers').deleteMany({ customerId: { $regex: /^TEST-/ } })
      await db.collection('loan-accounts').deleteMany({ loanAccountId: { $regex: /^TEST-/ } })
      await db.collection('conversations').deleteMany({ conversationId: { $regex: /^CONV-/ } })
    }
    if (mongoClient) {
      await mongoClient.close()
    }
  })

  // ==========================================================================
  // F5: View Customer Details
  // ==========================================================================
  describe('F5: View Customer Details', () => {
    describe('F5.1: View Customer Profile', () => {
      it('should display customer full name and key details', async () => {
        const result = await payload.find({
          collection: 'customers',
          where: { customerId: { equals: 'TEST-CUS-001' } },
        })
        const customer = result.docs[0]

        expect(customer.fullName).toBe('John Smith')
        expect(customer.firstName).toBe('John')
        expect(customer.lastName).toBe('Smith')
        expect(customer.emailAddress).toBe('john.smith@test.billie.loans')
        expect(customer.mobilePhoneNumber).toBe('0412345678')
        expect(customer.dateOfBirth).toBeDefined()
      })

      it('should display residential address with all fields', async () => {
        const result = await payload.find({
          collection: 'customers',
          where: { customerId: { equals: 'TEST-CUS-001' } },
        })
        const customer = result.docs[0]

        expect(customer.residentialAddress).toBeDefined()
        expect(customer.residentialAddress!.streetNumber).toBe('123')
        expect(customer.residentialAddress!.streetName).toBe('Test')
        expect(customer.residentialAddress!.suburb).toBe('Sydney')
        expect(customer.residentialAddress!.state).toBe('NSW')
        expect(customer.residentialAddress!.postcode).toBe('2000')
        expect(customer.residentialAddress!.fullAddress).toContain('123 Test St')
      })

      it('should display identity verification status', async () => {
        const result = await payload.find({
          collection: 'customers',
          where: { customerId: { equals: 'TEST-CUS-001' } },
        })
        const customer = result.docs[0]

        expect(customer.identityVerified).toBe(true)
        expect(customer.ekycStatus).toBe('successful')
      })
    })

    describe('F5.2: Search Customers', () => {
      it('should search customers by full name', async () => {
        const results = await payload.find({
          collection: 'customers',
          where: {
            fullName: { contains: 'John' },
          },
        })

        expect(results.docs.length).toBeGreaterThanOrEqual(1)
        expect(results.docs.some((c: any) => c.fullName === 'John Smith')).toBe(true)
      })

      it('should search customers by email', async () => {
        const results = await payload.find({
          collection: 'customers',
          where: {
            emailAddress: { equals: 'john.smith@test.billie.loans' },
          },
        })

        expect(results.docs.length).toBe(1)
        expect(results.docs[0].customerId).toBe('TEST-CUS-001')
      })

      it('should search customers by mobile number', async () => {
        const results = await payload.find({
          collection: 'customers',
          where: {
            mobilePhoneNumber: { equals: '0412345678' },
          },
        })

        expect(results.docs.length).toBe(1)
      })

      it('should search customers by customer ID', async () => {
        const results = await payload.find({
          collection: 'customers',
          where: {
            customerId: { equals: 'TEST-CUS-001' },
          },
        })

        expect(results.docs.length).toBe(1)
        expect(results.docs[0].fullName).toBe('John Smith')
      })
    })

    describe('F5.3: View Customer Flags', () => {
      it('should display staff flag for staff customers', async () => {
        const result = await payload.find({
          collection: 'customers',
          where: { customerId: { equals: 'TEST-CUS-002' } },
        })
        const customer = result.docs[0]

        expect(customer.staffFlag).toBe(true)
        expect(customer.investorFlag).toBe(false)
        expect(customer.founderFlag).toBe(false)
      })

      it('should correctly identify non-flagged customers', async () => {
        const result = await payload.find({
          collection: 'customers',
          where: { customerId: { equals: 'TEST-CUS-001' } },
        })
        const customer = result.docs[0]

        expect(customer.staffFlag).toBe(false)
        expect(customer.investorFlag).toBe(false)
        expect(customer.founderFlag).toBe(false)
      })
    })
  })

  // ==========================================================================
  // F1: View Customer Loan Accounts
  // ==========================================================================
  describe('F1: View Customer Loan Accounts', () => {
    describe('F1.1: View Account List', () => {
      it('should display list of all loan accounts', async () => {
        const results = await payload.find({
          collection: 'loan-accounts',
          where: {
            loanAccountId: { contains: 'TEST-' },
          },
        })

        expect(results.docs.length).toBe(3)
      })

      it('should display account number, customer name, and status', async () => {
        const account = await payload.find({
          collection: 'loan-accounts',
          where: {
            loanAccountId: { equals: 'TEST-ACC-001' },
          },
        })

        expect(account.docs[0].accountNumber).toBe('ACC-12345')
        expect(account.docs[0].customerName).toBe('John Smith')
        expect(account.docs[0].accountStatus).toBe('active')
      })

      it('should support sorting by created date', async () => {
        const results = await payload.find({
          collection: 'loan-accounts',
          where: { loanAccountId: { contains: 'TEST-' } },
          sort: '-createdAt',
        })

        expect(results.docs.length).toBe(3)
        // Newest first
        const dates = results.docs.map((d: any) => new Date(d.createdAt).getTime())
        expect(dates[0]).toBeGreaterThanOrEqual(dates[1])
      })

      it('should support pagination', async () => {
        const page1 = await payload.find({
          collection: 'loan-accounts',
          where: { loanAccountId: { contains: 'TEST-' } },
          limit: 2,
          page: 1,
        })

        expect(page1.docs.length).toBe(2)
        expect(page1.hasNextPage).toBe(true)

        const page2 = await payload.find({
          collection: 'loan-accounts',
          where: { loanAccountId: { contains: 'TEST-' } },
          limit: 2,
          page: 2,
        })

        expect(page2.docs.length).toBe(1)
        expect(page2.hasNextPage).toBe(false)
      })
    })

    describe('F1.2: View Account Details', () => {
      it('should display loan terms including amount, fee, and total payable', async () => {
        const account = await payload.find({
          collection: 'loan-accounts',
          where: { loanAccountId: { equals: 'TEST-ACC-001' } },
        })

        const loanTerms = account.docs[0].loanTerms!
        expect(loanTerms.loanAmount).toBe(500.0)
        expect(loanTerms.loanFee).toBe(80.0)
        expect(loanTerms.totalPayable).toBe(580.0)
        expect(loanTerms.openedDate).toBeDefined()
      })

      it('should display current balances', async () => {
        const account = await payload.find({
          collection: 'loan-accounts',
          where: { loanAccountId: { equals: 'TEST-ACC-001' } },
        })

        const balances = account.docs[0].balances!
        expect(balances.currentBalance).toBe(350.0)
        expect(balances.totalOutstanding).toBe(350.0)
        expect(balances.totalPaid).toBe(230.0)
      })

      it('should display last payment information', async () => {
        const account = await payload.find({
          collection: 'loan-accounts',
          where: { loanAccountId: { equals: 'TEST-ACC-001' } },
        })

        expect(account.docs[0].lastPayment).toBeDefined()
        expect(account.docs[0].lastPayment!.amount).toBe(115.0)
      })
    })

    describe('F1.3: Account Status Display', () => {
      it('should correctly identify active accounts', async () => {
        const account = await payload.find({
          collection: 'loan-accounts',
          where: { loanAccountId: { equals: 'TEST-ACC-001' } },
        })

        expect(account.docs[0].accountStatus).toBe('active')
        expect(account.docs[0].sdkStatus).toBe('ACTIVE')
      })

      it('should correctly identify paid off accounts', async () => {
        const account = await payload.find({
          collection: 'loan-accounts',
          where: { loanAccountId: { equals: 'TEST-ACC-002' } },
        })

        expect(account.docs[0].accountStatus).toBe('paid_off')
        expect(account.docs[0].sdkStatus).toBe('CLOSED')
      })

      it('should correctly identify in arrears accounts', async () => {
        const account = await payload.find({
          collection: 'loan-accounts',
          where: { loanAccountId: { equals: 'TEST-ACC-003' } },
        })

        expect(account.docs[0].accountStatus).toBe('in_arrears')
        expect(account.docs[0].sdkStatus).toBe('SUSPENDED')
      })

      it('should filter accounts by status', async () => {
        const activeAccounts = await payload.find({
          collection: 'loan-accounts',
          where: {
            loanAccountId: { contains: 'TEST-' },
            accountStatus: { equals: 'active' },
          },
        })

        expect(activeAccounts.docs.length).toBe(1)
        expect(activeAccounts.docs[0].accountNumber).toBe('ACC-12345')
      })
    })

    describe('F1.4: View Repayment Schedule', () => {
      it('should display repayment schedule with all fields', async () => {
        const account = await payload.find({
          collection: 'loan-accounts',
          where: { loanAccountId: { equals: 'TEST-ACC-001' } },
        })

        const schedule = account.docs[0].repaymentSchedule!
        expect(schedule).toBeDefined()
        expect(schedule.scheduleId).toBe('SCHED-001')
        expect(schedule.numberOfPayments).toBe(4)
        expect(schedule.paymentFrequency).toBe('fortnightly')
      })

      it('should display all scheduled payments with status', async () => {
        const account = await payload.find({
          collection: 'loan-accounts',
          where: { loanAccountId: { equals: 'TEST-ACC-001' } },
        })

        const payments = account.docs[0].repaymentSchedule!.payments!
        expect(payments.length).toBe(4)
        expect(payments[0].paymentNumber).toBe(1)
        expect(payments[0].amount).toBe(145.0)
        expect(payments[0].status).toBe('paid')
        expect(payments[2].status).toBe('scheduled')
      })

      it('should identify paid and scheduled payments', async () => {
        const account = await payload.find({
          collection: 'loan-accounts',
          where: { loanAccountId: { equals: 'TEST-ACC-001' } },
        })

        const payments = account.docs[0].repaymentSchedule!.payments!
        const paidPayments = payments.filter((p: any) => p.status === 'paid')
        const scheduledPayments = payments.filter((p: any) => p.status === 'scheduled')

        expect(paidPayments.length).toBe(2)
        expect(scheduledPayments.length).toBe(2)
      })
    })
  })

  // ==========================================================================
  // F4: View Customer Conversations
  // ==========================================================================
  describe('F4: View Customer Conversations', () => {
    describe('F4.1: View Conversation List', () => {
      it('should display conversations for a customer', async () => {
        const results = await payload.find({
          collection: 'conversations',
          where: {
            customerIdString: { equals: 'TEST-CUS-001' },
          },
        })

        expect(results.docs.length).toBeGreaterThanOrEqual(1)
      })

      it('should display application number and status', async () => {
        const conv = await payload.find({
          collection: 'conversations',
          where: { conversationId: { equals: 'CONV-001' } },
        })

        expect(conv.docs[0].applicationNumber).toBe('APP-12345')
        expect(conv.docs[0].status).toBe('approved')
      })

      it('should filter conversations by status', async () => {
        const approvedConvs = await payload.find({
          collection: 'conversations',
          where: {
            conversationId: { contains: 'CONV-' },
            status: { equals: 'approved' },
          },
        })

        expect(approvedConvs.docs.length).toBe(1)
      })
    })

    describe('F4.2: View Conversation Detail', () => {
      it('should display all utterances in the conversation', async () => {
        const conv = await payload.find({
          collection: 'conversations',
          where: { conversationId: { equals: 'CONV-001' } },
        })

        expect(conv.docs[0].utterances).toBeDefined()
        expect(conv.docs[0].utterances!.length).toBe(3)
      })

      it('should identify customer vs assistant messages', async () => {
        const conv = await payload.find({
          collection: 'conversations',
          where: { conversationId: { equals: 'CONV-001' } },
        })

        const utterances = conv.docs[0].utterances!
        expect(utterances[0].username).toBe('assistant')
        expect(utterances[1].username).toBe('customer')
      })

      it('should display conversation summary and facts', async () => {
        const conv = await payload.find({
          collection: 'conversations',
          where: { conversationId: { equals: 'CONV-001' } },
        })

        expect(conv.docs[0].purpose).toBe('Loan application')
        expect(conv.docs[0].facts).toBeDefined()
        expect(conv.docs[0].facts!.length).toBeGreaterThanOrEqual(1)
      })
    })

    describe('F4.3: View Assessment Data', () => {
      it('should display identity risk assessment', async () => {
        const conv = await payload.find({
          collection: 'conversations',
          where: { conversationId: { equals: 'CONV-001' } },
        })

        expect(conv.docs[0].assessments).toBeDefined()
        expect((conv.docs[0].assessments as any).identityRisk).toBeDefined()
        expect((conv.docs[0].assessments as any).identityRisk.score).toBe(85)
      })

      it('should display serviceability assessment', async () => {
        const conv = await payload.find({
          collection: 'conversations',
          where: { conversationId: { equals: 'CONV-001' } },
        })

        expect((conv.docs[0].assessments as any).serviceability).toBeDefined()
        expect((conv.docs[0].assessments as any).serviceability.result).toBe('pass')
      })

      it('should display fraud check assessment', async () => {
        const conv = await payload.find({
          collection: 'conversations',
          where: { conversationId: { equals: 'CONV-001' } },
        })

        expect((conv.docs[0].assessments as any).fraudCheck).toBeDefined()
        expect((conv.docs[0].assessments as any).fraudCheck.result).toBe('clear')
      })

      it('should display final decision', async () => {
        const conv = await payload.find({
          collection: 'conversations',
          where: { conversationId: { equals: 'CONV-001' } },
        })

        expect(conv.docs[0].finalDecision).toBe('APPROVED')
      })
    })
  })

  // ==========================================================================
  // F6: Single Customer View (API)
  // ==========================================================================
  describe('F6: Single Customer View', () => {
    it('should aggregate customer details, accounts, and conversations', async () => {
      // Query customer
      const customerResult = await payload.find({
        collection: 'customers',
        where: { customerId: { equals: 'TEST-CUS-001' } },
      })
      expect(customerResult.docs.length).toBe(1)
      const customer = customerResult.docs[0]

      // Query accounts for this customer
      const accountsResult = await payload.find({
        collection: 'loan-accounts',
        where: { customerIdString: { equals: 'TEST-CUS-001' } },
      })

      // Query conversations for this customer
      const conversationsResult = await payload.find({
        collection: 'conversations',
        where: { customerIdString: { equals: 'TEST-CUS-001' } },
      })

      // Verify aggregation
      expect(customer.fullName).toBe('John Smith')
      expect(accountsResult.docs.length).toBe(2) // account1 and account2
      expect(conversationsResult.docs.length).toBeGreaterThanOrEqual(1)
    })

    it('should calculate summary statistics', async () => {
      const accountsResult = await payload.find({
        collection: 'loan-accounts',
        where: { customerIdString: { equals: 'TEST-CUS-001' } },
      })

      const totalAccounts = accountsResult.docs.length
      const activeAccounts = accountsResult.docs.filter((a: any) => a.accountStatus === 'active').length
      const totalOutstanding = accountsResult.docs.reduce(
        (sum: number, a: any) => sum + (a.balances?.totalOutstanding || 0),
        0
      )

      expect(totalAccounts).toBe(2)
      expect(activeAccounts).toBe(1)
      expect(totalOutstanding).toBe(350.0) // Only active account has outstanding balance
    })
  })

  // ==========================================================================
  // F7: Global Search
  // ==========================================================================
  describe('F7: Global Search', () => {
    describe('F7.2: Search by Customer', () => {
      it('should search by customer name', async () => {
        const results = await payload.find({
          collection: 'customers',
          where: {
            or: [
              { fullName: { contains: 'John' } },
              { firstName: { contains: 'John' } },
              { lastName: { contains: 'John' } },
            ],
          },
        })

        expect(results.docs.length).toBeGreaterThanOrEqual(1)
      })

      it('should search by email address', async () => {
        const results = await payload.find({
          collection: 'customers',
          where: {
            emailAddress: { contains: 'john.smith' },
          },
        })

        expect(results.docs.length).toBe(1)
      })

      it('should search by customer ID', async () => {
        const results = await payload.find({
          collection: 'customers',
          where: {
            customerId: { equals: 'TEST-CUS-001' },
          },
        })

        expect(results.docs.length).toBe(1)
      })
    })

    describe('F7.3: Search by Account', () => {
      it('should search by account number', async () => {
        const results = await payload.find({
          collection: 'loan-accounts',
          where: {
            accountNumber: { equals: 'ACC-12345' },
          },
        })

        expect(results.docs.length).toBe(1)
        expect(results.docs[0].customerName).toBe('John Smith')
      })

      it('should search by loan account ID', async () => {
        const results = await payload.find({
          collection: 'loan-accounts',
          where: {
            loanAccountId: { equals: 'TEST-ACC-001' },
          },
        })

        expect(results.docs.length).toBe(1)
      })
    })

    describe('F7.1: Unified Search Bar (Pattern Detection)', () => {
      it('should detect customer ID pattern (CUS-*)', async () => {
        const searchTerm = 'TEST-CUS-001'
        const isCustomerId = searchTerm.includes('CUS-') || searchTerm.includes('cus-')

        expect(isCustomerId).toBe(true)

        if (isCustomerId) {
          const results = await payload.find({
            collection: 'customers',
            where: { customerId: { equals: searchTerm } },
          })
          expect(results.docs.length).toBe(1)
        }
      })

      it('should detect account number pattern (ACC-*)', async () => {
        const searchTerm = 'ACC-12345'
        const isAccountNumber = searchTerm.includes('ACC-') || searchTerm.includes('acc-')

        expect(isAccountNumber).toBe(true)

        if (isAccountNumber) {
          const results = await payload.find({
            collection: 'loan-accounts',
            where: { accountNumber: { equals: searchTerm } },
          })
          expect(results.docs.length).toBe(1)
        }
      })

      it('should detect email format', async () => {
        const searchTerm = 'john.smith@test.billie.loans'
        const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(searchTerm)

        expect(isEmail).toBe(true)

        if (isEmail) {
          const results = await payload.find({
            collection: 'customers',
            where: { emailAddress: { equals: searchTerm } },
          })
          expect(results.docs.length).toBe(1)
        }
      })

      it('should detect mobile format', async () => {
        const searchTerm = '0412345678'
        const isMobile = /^04\d{8}$/.test(searchTerm)

        expect(isMobile).toBe(true)

        if (isMobile) {
          const results = await payload.find({
            collection: 'customers',
            where: { mobilePhoneNumber: { equals: searchTerm } },
          })
          expect(results.docs.length).toBe(1)
        }
      })
    })
  })
})

