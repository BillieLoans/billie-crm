'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { getAddressForMapLink, getGoogleMapsUrl } from '@/lib/utils'

// Types
interface CustomerData {
  customer: {
    id: string
    customerId: string
    fullName: string
    firstName?: string
    lastName?: string
    emailAddress?: string
    mobilePhoneNumber?: string
    dateOfBirth?: string
    residentialAddress?: {
      street?: string
      suburb?: string
      city?: string
      state?: string
      postcode?: string
      fullAddress?: string
    }
    identityVerified: boolean
    ekycStatus?: string
    staffFlag: boolean
    investorFlag: boolean
    founderFlag: boolean
  }
  accounts: Array<{
    id: string
    loanAccountId: string
    accountNumber: string
    accountStatus: string
    loanTerms?: {
      loanAmount?: number
      loanFee?: number
      totalPayable?: number
      openedDate?: string
    }
    balances?: {
      currentBalance?: number
      totalOutstanding?: number
      totalPaid?: number
    }
    liveBalance?: {
      principalBalance: number
      feeBalance: number
      totalOutstanding: number
      asOf: string
    } | null
    lastPayment?: {
      date?: string
      amount?: number
    }
    repaymentSchedule?: {
      scheduleId?: string
      numberOfPayments?: number
      paymentFrequency?: string
      payments?: Array<{
        paymentNumber: number
        dueDate: string
        amount: number
        status: string
      }>
    }
    createdAt: string
  }>
  conversations: Array<{
    id: string
    conversationId: string
    applicationNumber: string
    status: string
    startedAt: string
    utteranceCount: number
    purpose?: string
  }>
  summary: {
    totalAccounts: number
    activeAccounts: number
    totalOutstanding: number
    totalConversations: number
  }
}

// Utility functions
function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(amount)
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    paid_off: 'bg-sky-100 text-sky-800 border-sky-200',
    in_arrears: 'bg-amber-100 text-amber-800 border-amber-200',
    written_off: 'bg-rose-100 text-rose-800 border-rose-200',
    approved: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    declined: 'bg-rose-100 text-rose-800 border-rose-200',
    soft_end: 'bg-slate-100 text-slate-600 border-slate-200',
    hard_end: 'bg-slate-200 text-slate-700 border-slate-300',
  }
  return colors[status] || 'bg-gray-100 text-gray-800 border-gray-200'
}

// Components
function Badge({ children, variant = 'default' }: { children: React.ReactNode; variant?: string }) {
  const variants: Record<string, string> = {
    default: 'bg-slate-100 text-slate-800',
    staff: 'bg-violet-100 text-violet-800',
    investor: 'bg-amber-100 text-amber-800',
    founder: 'bg-rose-100 text-rose-800',
    verified: 'bg-emerald-100 text-emerald-800',
  }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${variants[variant]}`}>
      {children}
    </span>
  )
}

function CustomerHeader({ customer }: { customer: CustomerData['customer'] }) {
  return (
    <div className="bg-white shadow-sm rounded-xl p-6 mb-6">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold text-slate-900">{customer.fullName}</h1>
            <div className="flex gap-2">
              {customer.staffFlag && <Badge variant="staff">Staff</Badge>}
              {customer.investorFlag && <Badge variant="investor">Investor</Badge>}
              {customer.founderFlag && <Badge variant="founder">Founder</Badge>}
              {customer.identityVerified && <Badge variant="verified">✓ Verified</Badge>}
            </div>
          </div>
          <p className="text-sm text-slate-500 font-mono">{customer.customerId}</p>
        </div>
        <div className="flex flex-col gap-1 text-sm text-slate-600">
          {customer.emailAddress && (
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              <a href={`mailto:${customer.emailAddress}`} className="text-blue-600 hover:underline">
                {customer.emailAddress}
              </a>
            </div>
          )}
          {customer.mobilePhoneNumber && (
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              <a href={`tel:${customer.mobilePhoneNumber}`} className="text-blue-600 hover:underline">
                {customer.mobilePhoneNumber}
              </a>
            </div>
          )}
          {(() => {
            const addr = customer.residentialAddress
            const displayAddress = addr?.fullAddress ?? (addr ? getAddressForMapLink(addr) : '')
            const mapAddress = addr ? getAddressForMapLink(addr) : ''
            const mapUrl = mapAddress ? getGoogleMapsUrl(mapAddress) : ''
            if (!displayAddress) return null
            return (
              <div className="flex items-start gap-2">
                <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span>{displayAddress}</span>
                {mapUrl && (
                  <a
                    href={mapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-400 hover:text-blue-600 inline-flex mt-0.5"
                    title="View on Google Maps"
                    aria-label="View address on Google Maps"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </a>
                )}
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}

function SummaryCards({ summary }: { summary: CustomerData['summary'] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div className="bg-white shadow-sm rounded-xl p-4">
        <div className="text-sm text-slate-500">Total Accounts</div>
        <div className="text-2xl font-bold text-slate-900">{summary.totalAccounts}</div>
      </div>
      <div className="bg-white shadow-sm rounded-xl p-4">
        <div className="text-sm text-slate-500">Active Accounts</div>
        <div className="text-2xl font-bold text-emerald-600">{summary.activeAccounts}</div>
      </div>
      <div className="bg-white shadow-sm rounded-xl p-4">
        <div className="text-sm text-slate-500">Total Outstanding</div>
        <div className="text-2xl font-bold text-slate-900">
          {formatCurrency(summary.totalOutstanding)}
        </div>
      </div>
      <div className="bg-white shadow-sm rounded-xl p-4">
        <div className="text-sm text-slate-500">Conversations</div>
        <div className="text-2xl font-bold text-slate-900">{summary.totalConversations}</div>
      </div>
    </div>
  )
}

function AccountCard({ account }: { account: CustomerData['accounts'][0] }) {
  const [showSchedule, setShowSchedule] = useState(false)
  const balance = account.liveBalance || account.balances
  const outstanding = balance?.totalOutstanding || 0

  return (
    <div className="bg-white shadow-sm rounded-xl p-5 border border-slate-100">
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-900">{account.accountNumber}</h3>
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${getStatusColor(account.accountStatus)}`}>
              {account.accountStatus.replace('_', ' ')}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Opened {account.loanTerms?.openedDate ? formatDate(account.loanTerms.openedDate) : formatDate(account.createdAt)}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xl font-bold text-slate-900">{formatCurrency(outstanding)}</div>
          <p className="text-xs text-slate-500">Outstanding</p>
          {account.liveBalance && (
            <p className="text-[10px] text-emerald-600">
              Live as of {new Date(account.liveBalance.asOf).toLocaleTimeString()}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 text-sm mb-4">
        <div>
          <span className="text-slate-500">Loan Amount</span>
          <div className="font-medium">{formatCurrency(account.loanTerms?.loanAmount || 0)}</div>
        </div>
        <div>
          <span className="text-slate-500">Total Payable</span>
          <div className="font-medium">{formatCurrency(account.loanTerms?.totalPayable || 0)}</div>
        </div>
        <div>
          <span className="text-slate-500">Total Paid</span>
          <div className="font-medium text-emerald-600">{formatCurrency(account.balances?.totalPaid || 0)}</div>
        </div>
      </div>

      {account.lastPayment?.date && (
        <div className="text-sm text-slate-600 mb-4">
          Last payment: {formatCurrency(account.lastPayment.amount || 0)} on{' '}
          {formatDate(account.lastPayment.date)}
        </div>
      )}

      {account.repaymentSchedule && account.repaymentSchedule.payments && (
        <div className="border-t border-slate-100 pt-4">
          <button
            onClick={() => setShowSchedule(!showSchedule)}
            className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800"
          >
            <svg
              className={`w-4 h-4 transition-transform ${showSchedule ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {account.repaymentSchedule.numberOfPayments} payments ({account.repaymentSchedule.paymentFrequency})
          </button>

          {showSchedule && (
            <div className="mt-3 space-y-2">
              {account.repaymentSchedule.payments.map((payment) => (
                <div
                  key={payment.paymentNumber}
                  className={`flex justify-between items-center text-sm p-2 rounded ${
                    payment.status === 'paid'
                      ? 'bg-emerald-50'
                      : payment.status === 'missed'
                        ? 'bg-rose-50'
                        : 'bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">#{payment.paymentNumber}</span>
                    <span>{formatDate(payment.dueDate)}</span>
                    {payment.status === 'paid' && (
                      <span className="text-emerald-600">✓</span>
                    )}
                    {payment.status === 'missed' && (
                      <span className="text-rose-600">✗</span>
                    )}
                  </div>
                  <span className="font-medium">{formatCurrency(payment.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 mt-4 pt-4 border-t border-slate-100">
        <Link
          href={`/dashboard/accounts/${account.loanAccountId}`}
          className="flex-1 text-center py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors"
        >
          View Details
        </Link>
        <Link
          href={`/dashboard/accounts/${account.loanAccountId}/transactions`}
          className="flex-1 text-center py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Transactions
        </Link>
      </div>
    </div>
  )
}

function ConversationList({ conversations }: { conversations: CustomerData['conversations'] }) {
  if (conversations.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500">
        No conversations found
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {conversations.map((conv) => (
        <Link
          key={conv.id}
          href={`/dashboard/conversations/${conv.conversationId}`}
          className="block bg-white shadow-sm rounded-xl p-4 border border-slate-100 hover:border-blue-200 hover:shadow-md transition-all"
        >
          <div className="flex justify-between items-start">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-900">{conv.applicationNumber}</span>
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${getStatusColor(conv.status)}`}>
                  {conv.status.replace('_', ' ')}
                </span>
              </div>
              {conv.purpose && (
                <p className="text-sm text-slate-600 mt-1">{conv.purpose}</p>
              )}
            </div>
            <div className="text-right text-sm text-slate-500">
              <div>{formatDate(conv.startedAt)}</div>
              <div>{conv.utteranceCount} messages</div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
}

// Main Page Component
export default function CustomerPage() {
  const params = useParams()
  const customerId = params.customerId as string
  const [data, setData] = useState<CustomerData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'accounts' | 'conversations'>('accounts')

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true)
        const response = await fetch(`/api/customer/${customerId}`)
        if (!response.ok) {
          throw new Error('Failed to fetch customer data')
        }
        const result = await response.json()
        setData(result)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    }

    if (customerId) {
      fetchData()
    }
  }, [customerId])

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="animate-pulse">
            <div className="bg-white rounded-xl p-6 mb-6">
              <div className="h-8 bg-slate-200 rounded w-1/3 mb-4"></div>
              <div className="h-4 bg-slate-200 rounded w-1/4"></div>
            </div>
            <div className="grid grid-cols-4 gap-4 mb-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="bg-white rounded-xl p-4">
                  <div className="h-4 bg-slate-200 rounded w-2/3 mb-2"></div>
                  <div className="h-8 bg-slate-200 rounded w-1/2"></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-center">
            <h2 className="text-lg font-semibold text-rose-800 mb-2">Error Loading Customer</h2>
            <p className="text-rose-600">{error || 'Customer not found'}</p>
            <Link
              href="/dashboard"
              className="inline-block mt-4 px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700"
            >
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white py-4 px-6">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <Link href="/dashboard" className="text-slate-400 hover:text-white transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div>
            <h1 className="text-lg font-semibold">Customer View</h1>
            <p className="text-sm text-slate-400">Single Customer View</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto p-6">
        <CustomerHeader customer={data.customer} />
        <SummaryCards summary={data.summary} />

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white p-1 rounded-lg shadow-sm">
          <button
            onClick={() => setActiveTab('accounts')}
            className={`flex-1 py-2.5 px-4 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'accounts'
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Loan Accounts ({data.accounts.length})
          </button>
          <button
            onClick={() => setActiveTab('conversations')}
            className={`flex-1 py-2.5 px-4 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'conversations'
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Conversations ({data.conversations.length})
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'accounts' ? (
          <div className="grid md:grid-cols-2 gap-4">
            {data.accounts.length === 0 ? (
              <div className="col-span-2 text-center py-8 text-slate-500 bg-white rounded-xl">
                No loan accounts found
              </div>
            ) : (
              data.accounts.map((account) => (
                <AccountCard key={account.id} account={account} />
              ))
            )}
          </div>
        ) : (
          <ConversationList conversations={data.conversations} />
        )}
      </div>
    </div>
  )
}

