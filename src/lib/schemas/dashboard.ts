import { z } from 'zod'

/**
 * Schema for a recently created account.
 */
export const RecentAccountSchema = z.object({
  loanAccountId: z.string(),
  accountNumber: z.string(),
  customerName: z.string(),
  customerId: z.string(),
  loanAmount: z.number(),
  loanAmountFormatted: z.string(),
  createdAt: z.string().datetime(),
})

export type RecentAccount = z.infer<typeof RecentAccountSchema>

/**
 * Schema for a loan account pending disbursement.
 */
export const PendingDisbursementSchema = z.object({
  loanAccountId: z.string(),
  accountNumber: z.string(),
  customerName: z.string(),
  customerId: z.string(),
  loanAmount: z.number(),
  loanAmountFormatted: z.string(),
  createdAt: z.string().datetime(),
  signedLoanAgreementUrl: z.string().nullable().optional(),
})

export type PendingDisbursement = z.infer<typeof PendingDisbursementSchema>

/**
 * Schema for an upcoming payment.
 */
export const UpcomingPaymentSchema = z.object({
  loanAccountId: z.string(),
  accountNumber: z.string(),
  customerName: z.string(),
  customerId: z.string(),
  dueDate: z.string(), // ISO date string
  amount: z.number(),
  amountFormatted: z.string(),
  daysUntilDue: z.number().int(), // negative = overdue
  status: z.enum(['overdue', 'due_today', 'upcoming']),
})

export type UpcomingPayment = z.infer<typeof UpcomingPaymentSchema>

/**
 * Dashboard API response schema.
 *
 * Used by:
 * - GET /api/dashboard route for response validation
 * - useDashboard hook for type safety
 *
 * Story 6.2: Dashboard Home Page
 */
export const DashboardResponseSchema = z.object({
  user: z.object({
    firstName: z.string(),
    role: z.enum(['admin', 'supervisor', 'operations', 'readonly']),
  }),
  actionItems: z.object({
    pendingApprovalsCount: z.number().int().min(0),
    failedActionsCount: z.number().int().min(0),
  }),
  recentCustomersSummary: z.array(
    z.object({
      customerId: z.string(),
      name: z.string(),
      accountCount: z.number().int().min(0),
      totalOutstanding: z.string(),
    }),
  ),
  // Recently created accounts for onboarding visibility
  recentAccounts: z.array(RecentAccountSchema),
  // Upcoming payments for manual payment processing
  upcomingPayments: z.array(UpcomingPaymentSchema),
  // Loans pending disbursement
  pendingDisbursements: z.array(PendingDisbursementSchema),
  pendingDisbursementsCount: z.number().int().min(0),
  systemStatus: z.object({
    ledger: z.enum(['online', 'degraded', 'offline']),
    latencyMs: z.number().int().min(0),
    lastChecked: z.string().datetime(),
  }),
})

export type DashboardResponse = z.infer<typeof DashboardResponseSchema>

/**
 * Query params for dashboard API.
 */
export const DashboardQuerySchema = z.object({
  recentCustomerIds: z
    .string()
    .optional()
    .transform((val) => (val ? val.split(',').filter(Boolean).slice(0, 10) : [])),
})

export type DashboardQuery = z.infer<typeof DashboardQuerySchema>
