'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useVersionStore } from '@/stores/version'

/**
 * Individual scheduled payment in the repayment schedule.
 */
export interface ScheduledPayment {
  paymentNumber: number
  dueDate: string
  amount: number
  status: 'scheduled' | 'paid' | 'missed' | 'partial' | null
  id?: string | null
  /** Amount actually paid (for paid/partial payments) */
  amountPaid?: number | null
  /** Amount remaining to be paid */
  amountRemaining?: number | null
  /** Date when payment was made */
  paidDate?: string | null
  /** IDs of transactions linked to this payment */
  linkedTransactionIds?: string[] | null
  /** Last time this payment was updated */
  lastUpdated?: string | null
}

/**
 * Live balance data from gRPC ledger service.
 */
export interface LiveBalanceData {
  principalBalance: number
  feeBalance: number
  totalOutstanding: number
  asOf: string
}

/**
 * Loan account data returned by the customer API.
 */
export interface LoanAccountData {
  id: string
  loanAccountId: string
  accountNumber: string
  accountStatus: 'pending_disbursement' | 'active' | 'paid_off' | 'in_arrears' | 'written_off'
  loanTerms: {
    loanAmount: number | null
    loanFee: number | null
    totalPayable: number | null
    openedDate: string | null
  } | null
  balances: {
    currentBalance: number | null
    totalOutstanding: number | null
    totalPaid: number | null
  } | null
  liveBalance: LiveBalanceData | null
  lastPayment: {
    date: string | null
    amount: number | null
  } | null
  repaymentSchedule: {
    scheduleId: string | null
    numberOfPayments: number | null
    paymentFrequency: 'weekly' | 'fortnightly' | 'monthly' | null
    payments: ScheduledPayment[] | null
    createdDate: string | null
  } | null
  createdAt: string
  /** Last update timestamp for version conflict detection */
  updatedAt: string
}

/**
 * Subset of customer data returned by the API.
 * Matches the shape used by ServicingView.
 */
export interface CustomerData {
  id: string
  customerId: string
  fullName: string | null
  firstName: string | null
  lastName: string | null
  preferredName: string | null
  emailAddress: string | null
  mobilePhoneNumber: string | null
  dateOfBirth: string | null
  identityVerified: boolean | null
  staffFlag: boolean | null
  investorFlag: boolean | null
  founderFlag: boolean | null
  vulnerableFlag: boolean | null
  residentialAddress: {
    fullAddress?: string | null
    street?: string | null
    suburb?: string | null
    state?: string | null
    postcode?: string | null
  } | null
  loanAccounts?: LoanAccountData[] | null
}

interface CustomerApiResponse {
  customer: Omit<CustomerData, 'loanAccounts'>
  accounts: LoanAccountData[]
  summary: {
    totalAccounts: number
    activeAccounts: number
    totalOutstanding: number
  }
}

async function fetchCustomer(customerId: string): Promise<CustomerData> {
  const res = await fetch(`/api/customer/${customerId}`)
  
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('Customer not found')
    }
    throw new Error('Failed to fetch customer')
  }
  
  const data: CustomerApiResponse = await res.json()
  
  // Merge customer and accounts into CustomerData shape
  return {
    ...data.customer,
    loanAccounts: data.accounts,
  }
}

/**
 * Hook to fetch a single customer by customerId.
 * 
 * Automatically tracks loan account versions for conflict detection.
 * When customer data is loaded, each loan account's version (updatedAt)
 * is stored in the version store for later comparison during mutations.
 * 
 * @param customerId - The customer's unique ID
 * @returns TanStack Query result with customer data
 */
export function useCustomer(customerId: string) {
  const setVersion = useVersionStore((state) => state.setVersion)

  const query = useQuery({
    queryKey: ['customer', customerId],
    queryFn: () => fetchCustomer(customerId),
    enabled: !!customerId,
    staleTime: 60_000, // 1 minute - customer data doesn't change often
    retry: false, // Don't retry on 404
  })

  // Track loan account versions when data is loaded/updated
  useEffect(() => {
    if (query.data?.loanAccounts) {
      query.data.loanAccounts.forEach((account) => {
        if (account.loanAccountId && account.updatedAt) {
          setVersion(account.loanAccountId, account.updatedAt, account.id)
        }
      })
    }
  }, [query.data, setVersion])

  return query
}
