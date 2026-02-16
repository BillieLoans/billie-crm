/**
 * API Route: GET /api/customer/[customerId]
 *
 * Single Customer View - Get all data for a customer including:
 * - Customer details (from projection)
 * - Loan accounts (from projection)
 * - Recent conversations (from projection)
 * - Live balances (from gRPC)
 */

import { NextRequest, NextResponse } from 'next/server'
import configPromise from '@payload-config'
import { getPayload } from 'payload'
import { getLedgerClient, timestampToDate } from '@/server/grpc-client'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ customerId: string }> }
) {
  try {
    const { customerId } = await params
    const payload = await getPayload({ config: configPromise })

    // 1. Get customer details
    const customersResult = await payload.find({
      collection: 'customers',
      where: {
        customerId: { equals: customerId },
      },
      limit: 1,
    })

    if (customersResult.docs.length === 0) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    const customer = customersResult.docs[0]

    // 2. Get loan accounts for this customer
    const accountsResult = await payload.find({
      collection: 'loan-accounts',
      where: {
        customerIdString: { equals: customerId },
      },
      sort: '-createdAt',
    })

    // 3. Get live balances from gRPC for each account
    const ledgerClient = getLedgerClient()
    const accountsWithBalances = await Promise.all(
      accountsResult.docs.map(async (account) => {
        try {
          const balance = await ledgerClient.getBalance({
            loanAccountId: account.loanAccountId,
          })
          return {
            ...account,
            liveBalance: {
              principalBalance: parseFloat(balance.principalBalance),
              feeBalance: parseFloat(balance.feeBalance),
              totalOutstanding: parseFloat(balance.totalOutstanding),
              asOf: timestampToDate(balance.asOf).toISOString(),
            },
          }
        } catch (error) {
          // If gRPC call fails, return account without live balance
          console.warn(`Failed to get live balance for account ${account.loanAccountId}:`, error)
          return {
            ...account,
            liveBalance: null,
          }
        }
      })
    )

    // 4. Get recent conversations
    const conversationsResult = await payload.find({
      collection: 'conversations',
      where: {
        customerIdString: { equals: customerId },
      },
      sort: '-startedAt',
      limit: 10,
    })

    // 5. Build activity timeline
    const timeline = buildActivityTimeline(accountsWithBalances, conversationsResult.docs)

    return NextResponse.json({
      customer: {
        id: customer.id,
        customerId: customer.customerId,
        fullName: customer.fullName,
        firstName: customer.firstName,
        lastName: customer.lastName,
        emailAddress: customer.emailAddress,
        mobilePhoneNumber: customer.mobilePhoneNumber,
        dateOfBirth: customer.dateOfBirth,
        residentialAddress: customer.residentialAddress,
        identityVerified: customer.identityVerified || false,
        ekycStatus: customer.ekycStatus,
        staffFlag: customer.staffFlag || false,
        investorFlag: customer.investorFlag || false,
        founderFlag: customer.founderFlag || false,
      },
      accounts: accountsWithBalances.map((account) => ({
        id: account.id,
        loanAccountId: account.loanAccountId,
        accountNumber: account.accountNumber,
        accountStatus: account.accountStatus,
        loanTerms: account.loanTerms,
        balances: account.balances,
        liveBalance: account.liveBalance,
        lastPayment: account.lastPayment,
        repaymentSchedule: account.repaymentSchedule,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt, // For version conflict detection
        signedLoanAgreementUrl: account.signedLoanAgreementUrl ?? undefined,
      })),
      conversations: conversationsResult.docs.map((conv) => ({
        id: conv.id,
        conversationId: conv.conversationId,
        applicationNumber: conv.applicationNumber,
        status: conv.status,
        startedAt: conv.startedAt,
        utteranceCount: conv.utterances?.length || 0,
        purpose: conv.purpose,
      })),
      timeline,
      summary: {
        totalAccounts: accountsWithBalances.length,
        activeAccounts: accountsWithBalances.filter((a) => a.accountStatus === 'active').length,
        totalOutstanding: accountsWithBalances.reduce(
          (sum, a) => sum + (a.liveBalance?.totalOutstanding || a.balances?.totalOutstanding || 0),
          0
        ),
        totalConversations: conversationsResult.docs.length,
      },
    })
  } catch (error) {
    console.error('Error fetching customer data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch customer data', details: (error as Error).message },
      { status: 500 }
    )
  }
}

interface TimelineItem {
  type: 'account_created' | 'conversation' | 'payment' | 'fee'
  date: string
  title: string
  description: string
  metadata: Record<string, any>
}

function buildActivityTimeline(accounts: any[], conversations: any[]): TimelineItem[] {
  const timeline: TimelineItem[] = []

  // Add account creation events
  for (const account of accounts) {
    timeline.push({
      type: 'account_created',
      date: account.createdAt,
      title: 'Loan Account Created',
      description: `Account ${account.accountNumber} created`,
      metadata: {
        accountId: account.loanAccountId,
        accountNumber: account.accountNumber,
        loanAmount: account.loanTerms?.loanAmount,
      },
    })
  }

  // Add conversation events
  for (const conv of conversations) {
    timeline.push({
      type: 'conversation',
      date: conv.startedAt,
      title: 'Conversation Started',
      description: `Application ${conv.applicationNumber} - ${conv.status}`,
      metadata: {
        conversationId: conv.conversationId,
        applicationNumber: conv.applicationNumber,
        status: conv.status,
      },
    })
  }

  // Sort by date descending
  timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return timeline.slice(0, 20) // Limit to 20 most recent items
}

