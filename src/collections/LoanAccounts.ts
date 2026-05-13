import type { CollectionConfig, Access } from 'payload'
import { hideFromNonAdmins, hasAnyRole } from '@/lib/access'

const servicingAccess: Access = ({ req: { user } }) => {
  return hasAnyRole(user)
}

export const LoanAccounts: CollectionConfig = {
  slug: 'loan-accounts',
  admin: {
    useAsTitle: 'accountNumber',
    defaultColumns: [
      'accountNumber',
      'customerName',
      'accountStatus',
      'balances.totalOutstanding',
      'createdAt',
    ],
    group: 'Servicing',
    description: 'Loan accounts projected from ledger events',
    // Hide from sidebar for non-admins - use ServicingView instead (Story 6.7)
    hidden: hideFromNonAdmins,
    components: {
      views: {
        edit: {
          // Custom tab for servicing operations
          Servicing: {
            Component: '@/components/LoanAccountServicing#LoanAccountServicing',
            path: '/servicing',
            tab: {
              label: 'Servicing',
              href: '/servicing',
            },
          },
        },
      },
    },
  },
  access: {
    read: servicingAccess,
    create: () => false, // Only created via event processor
    update: () => false, // Only updated via event processor
    delete: () => false,
  },
  fields: [
    // === Core Identifiers ===
    {
      name: 'loanAccountId',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        readOnly: true,
        description: 'Unique identifier from ledger service (account_id)',
      },
    },
    {
      name: 'accountNumber',
      type: 'text',
      required: true,
      index: true,
      admin: {
        readOnly: true,
        description: 'Human-readable account number',
      },
    },
    {
      name: 'customerId',
      type: 'relationship',
      relationTo: 'customers',
      index: true,
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'customerIdString',
      type: 'text',
      index: true,
      admin: {
        readOnly: true,
        description: 'Customer ID string for queries',
      },
    },
    {
      name: 'customerName',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'Denormalized for list view performance',
      },
    },

    // === Loan Terms (from account.created.v1) ===
    {
      name: 'loanTerms',
      type: 'group',
      admin: {
        description: 'Original loan terms at disbursement',
      },
      fields: [
        {
          name: 'loanAmount',
          type: 'number',
          admin: {
            readOnly: true,
            step: 0.01,
            description: 'Original loan amount (from SDK: loan_amount)',
          },
        },
        {
          name: 'loanFee',
          type: 'number',
          admin: {
            readOnly: true,
            step: 0.01,
            description: 'Fee amount (from SDK: loan_fee)',
          },
        },
        {
          name: 'totalPayable',
          type: 'number',
          admin: {
            readOnly: true,
            step: 0.01,
            description: 'Total amount to be repaid (from SDK: loan_total_payable)',
          },
        },
        {
          name: 'openedDate',
          type: 'date',
          admin: {
            readOnly: true,
            date: { pickerAppearance: 'dayOnly' },
            description: 'Account opening date (from SDK: opened_date)',
          },
        },
      ],
    },

    // === Current Balances ===
    {
      name: 'balances',
      type: 'group',
      admin: {
        description: 'Current account balances (updated from events)',
      },
      fields: [
        {
          name: 'currentBalance',
          type: 'number',
          admin: {
            readOnly: true,
            step: 0.01,
            description: 'Current outstanding balance (from SDK: current_balance)',
          },
        },
        {
          name: 'totalOutstanding',
          type: 'number',
          admin: {
            readOnly: true,
            step: 0.01,
            description: 'Total amount currently owed',
          },
        },
        {
          name: 'totalPaid',
          type: 'number',
          admin: {
            readOnly: true,
            step: 0.01,
            description: 'Total amount paid to date',
          },
        },
      ],
    },

    // === Last Payment (from account.updated.v1) ===
    {
      name: 'lastPayment',
      type: 'group',
      admin: {
        description: 'Most recent payment details',
      },
      fields: [
        {
          name: 'date',
          type: 'date',
          admin: {
            readOnly: true,
            description: 'From SDK: last_payment_date',
          },
        },
        {
          name: 'amount',
          type: 'number',
          admin: {
            readOnly: true,
            step: 0.01,
            description: 'From SDK: last_payment_amount',
          },
        },
      ],
    },

    // === Aging (from loan.aging.updated.v1, aging-v1.1.0+) ===
    {
      name: 'aging',
      type: 'group',
      admin: {
        description: 'Latest aging snapshot projected from loan.aging.updated.v1',
      },
      fields: [
        {
          name: 'isInArrears',
          type: 'checkbox',
          defaultValue: false,
          index: true,
          admin: {
            readOnly: true,
            description:
              'Authoritative flag from the aging service: bucket not in {current,closed} AND not terminal',
          },
        },
        {
          name: 'bucket',
          type: 'select',
          options: [
            { label: 'Current', value: 'current' },
            { label: 'Early Arrears', value: 'early_arrears' },
            { label: 'Late Arrears', value: 'late_arrears' },
            { label: 'Default', value: 'default' },
            { label: 'Closed', value: 'closed' },
          ],
          index: true,
          admin: {
            readOnly: true,
            description: 'Aging bucket at last update',
          },
        },
        {
          name: 'currentDPD',
          type: 'number',
          admin: {
            readOnly: true,
            description: 'Days past due at last update',
          },
        },
        {
          name: 'lastUpdated',
          type: 'date',
          admin: {
            readOnly: true,
            description: 'When the aging snapshot was last refreshed',
          },
        },
      ],
    },

    // === Status ===
    {
      name: 'accountStatus',
      type: 'select',
      required: true,
      index: true,
      options: [
        { label: 'Pending Disbursement', value: 'pending_disbursement' },
        { label: 'Active', value: 'active' },
        { label: 'Paid Off', value: 'paid_off' },
        { label: 'In Arrears', value: 'in_arrears' },
        { label: 'Written Off', value: 'written_off' },
      ],
      defaultValue: 'active',
      admin: {
        readOnly: true,
        description: 'Mapped from SDK AccountStatus enum',
      },
    },
    {
      name: 'sdkStatus',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'Original status from SDK (PENDING, ACTIVE, SUSPENDED, CLOSED)',
      },
    },
    {
      name: 'signedLoanAgreementUrl',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'S3 URI for signed loan agreement document (from SDK: signed_loan_agreement_url, accounts-v2.7.0+)',
      },
    },

    // === Closure (from account.closed.v1, accounts-v2.8.0+) ===
    {
      name: 'closure',
      type: 'group',
      admin: {
        description: 'Closure snapshot from account.closed.v1',
        condition: (data) =>
          data?.accountStatus === 'paid_off' || data?.accountStatus === 'written_off',
      },
      fields: [
        {
          name: 'reason',
          type: 'select',
          options: [
            { label: 'Paid Off', value: 'PAID_OFF' },
            { label: 'Written Off', value: 'WRITTEN_OFF' },
            { label: 'Admin Closed', value: 'ADMIN_CLOSED' },
          ],
          admin: {
            readOnly: true,
            description: 'Why the account was closed (from SDK: closure_reason)',
          },
        },
        {
          name: 'previousStatus',
          type: 'text',
          admin: {
            readOnly: true,
            description: 'SDK status the account transitioned from (e.g. ACTIVE, SUSPENDED)',
          },
        },
        {
          name: 'closedDate',
          type: 'date',
          admin: {
            readOnly: true,
            description: 'When the account was closed (from SDK: closed_date)',
          },
        },
        {
          name: 'finalBalance',
          type: 'number',
          admin: {
            readOnly: true,
            step: 0.01,
            description: 'Outstanding balance at closure (0 for PAID_OFF)',
          },
        },
        {
          name: 'totalPaid',
          type: 'number',
          admin: {
            readOnly: true,
            step: 0.01,
            description: 'Cumulative amount paid by the customer at closure',
          },
        },
        {
          name: 'loanTotalPayable',
          type: 'number',
          admin: {
            readOnly: true,
            step: 0.01,
            description: 'Original total payable amount',
          },
        },
        {
          name: 'triggeredByTransactionId',
          type: 'text',
          admin: {
            readOnly: true,
            description: 'Ledger transaction that pushed balance to zero (PAID_OFF only)',
          },
        },
      ],
    },

    // === Repayment Schedule (from account.schedule.created.v1) ===
    {
      name: 'repaymentSchedule',
      type: 'group',
      admin: {
        description: 'Repayment schedule from account.schedule.created.v1',
      },
      fields: [
        {
          name: 'scheduleId',
          type: 'text',
          admin: {
            readOnly: true,
            description: 'Unique schedule identifier',
          },
        },
        {
          name: 'numberOfPayments',
          type: 'number',
          admin: {
            readOnly: true,
            description: 'Total number of scheduled payments (from SDK: n_payments)',
          },
        },
        {
          name: 'paymentFrequency',
          type: 'select',
          options: [
            { label: 'Weekly', value: 'weekly' },
            { label: 'Fortnightly', value: 'fortnightly' },
            { label: 'Monthly', value: 'monthly' },
          ],
          admin: {
            readOnly: true,
            description: 'Payment frequency',
          },
        },
        {
          name: 'payments',
          type: 'array',
          admin: {
            readOnly: true,
            description: 'Individual scheduled payments',
          },
          fields: [
            {
              name: 'paymentNumber',
              type: 'number',
              required: true,
              admin: {
                description: 'Payment sequence number (1, 2, 3...)',
              },
            },
            {
              name: 'dueDate',
              type: 'date',
              required: true,
              admin: {
                date: { pickerAppearance: 'dayOnly' },
              },
            },
            {
              name: 'amount',
              type: 'number',
              required: true,
              admin: {
                step: 0.01,
                description: 'Scheduled payment amount',
              },
            },
            {
              name: 'status',
              type: 'select',
              options: [
                { label: 'Scheduled', value: 'scheduled' },
                { label: 'Paid', value: 'paid' },
                { label: 'Missed', value: 'missed' },
                { label: 'Partial', value: 'partial' },
              ],
              defaultValue: 'scheduled',
            },
            {
              name: 'amountPaid',
              type: 'number',
              admin: {
                readOnly: true,
                step: 0.01,
                description: 'Amount actually paid (from schedule.updated)',
              },
            },
            {
              name: 'amountRemaining',
              type: 'number',
              admin: {
                readOnly: true,
                step: 0.01,
                description: 'Amount still owed on this payment',
              },
            },
            {
              name: 'paidDate',
              type: 'date',
              admin: {
                readOnly: true,
                description: 'Date payment was completed',
              },
            },
            {
              name: 'linkedTransactionIds',
              type: 'json',
              admin: {
                readOnly: true,
                description: 'Transaction IDs linked to this payment',
              },
            },
            {
              name: 'lastUpdated',
              type: 'date',
              admin: {
                readOnly: true,
                description: 'Last time this payment was updated',
              },
            },
          ],
        },
        {
          name: 'createdDate',
          type: 'date',
          admin: {
            readOnly: true,
            description: 'Schedule creation date',
          },
        },
      ],
    },
  ],
  timestamps: true,
}

