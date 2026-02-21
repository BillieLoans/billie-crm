// Query hooks barrel export
export { useCustomerSearch } from './useCustomerSearch'
export { useLoanAccountSearch } from './useLoanAccountSearch'
export { useCustomer } from './useCustomer'
export type { CustomerData, LoanAccountData, LiveBalanceData } from './useCustomer'
export { useTransactions, TRANSACTION_TYPES, transactionsQueryKey } from './useTransactions'
export type { Transaction, TransactionsResponse, TransactionFilters } from './useTransactions'

// Ledger integration hooks
export { useOverdueAccounts, overdueAccountsQueryKey } from './useOverdueAccounts'
export type {
  OverdueAccount,
  OverdueAccountsResponse,
  OverdueAccountsFilters,
  UseOverdueAccountsOptions,
} from './useOverdueAccounts'

export { usePortfolioECL, portfolioECLQueryKey } from './usePortfolioECL'
export type {
  ECLBucketSummary,
  PortfolioECLResponse,
  UsePortfolioECLOptions,
} from './usePortfolioECL'

export { useEventProcessingStatus, eventProcessingStatusQueryKey } from './useEventProcessingStatus'
export type {
  StreamProcessingStatus,
  EventProcessingStatusResponse,
  UseEventProcessingStatusOptions,
} from './useEventProcessingStatus'

// Account detail hooks (Epic 2)
export { useAccountAging, accountAgingQueryKey } from './useAccountAging'
export type {
  AccountAgingResponse,
  BucketTransition,
  UseAccountAgingOptions,
} from './useAccountAging'

export { useAccruedYield, useAccrualHistory, accruedYieldQueryKey, accrualHistoryQueryKey } from './useAccruedYield'
export type {
  AccruedYieldResponse,
  AccrualCalculationBreakdown,
  AccrualEvent,
  AccrualHistoryResponse,
  UseAccruedYieldOptions,
  UseAccrualHistoryOptions,
} from './useAccruedYield'

export { useECLAllowance, eclAllowanceQueryKey } from './useECLAllowance'
export type {
  ECLAllowanceResponse,
  ECLTrigger,
  ECLHistoryEntry,
  ECLCalculationBreakdown,
  UseECLAllowanceOptions,
} from './useECLAllowance'

// Schedule with status hook (E2-S7)
export { useScheduleWithStatus, scheduleWithStatusQueryKey } from './useScheduleWithStatus'
export type {
  InstalmentWithStatus,
  ScheduleSummary,
  ScheduleWithStatusResponse,
  UseScheduleWithStatusOptions,
} from './useScheduleWithStatus'

// Carrying amount breakdown hook (E2-S9)
export { useCarryingAmountBreakdown, carryingAmountBreakdownQueryKey } from './useCarryingAmountBreakdown'
export type {
  CarryingAmountBreakdownResponse,
  UseCarryingAmountBreakdownOptions,
} from './useCarryingAmountBreakdown'

// Period Close hooks (E3)
export { useClosedPeriods } from './useClosedPeriods'
export type { ClosedPeriod } from './useClosedPeriods'

// ECL Config hooks (E4)
export { useECLConfig, eclConfigQueryKey } from './useECLConfig'
export type { ECLConfig, PDRateConfig } from './useECLConfig'
export { useECLConfigHistory, eclConfigHistoryQueryKey } from './useECLConfigHistory'
export type { ECLConfigHistoryEntry, ECLConfigHistoryResponse, UseECLConfigHistoryOptions } from './useECLConfigHistory'
export { usePendingConfigChanges, pendingConfigChangesQueryKey } from './usePendingConfigChanges'
export type { PendingConfigChange, PendingConfigChangesResponse } from './usePendingConfigChanges'

// Export Center hooks (E5)
export { useExportJobs, exportJobsQueryKey } from './useExportJobs'
export type { ExportJob, ExportJobStatus, ExportJobType, ExportFormat, ExportJobsResponse, UseExportJobsOptions } from './useExportJobs'

// Investigation hooks (E6)
export { useEventHistory, eventHistoryQueryKey } from './useEventHistory'
export type { AccountEvent, EventHistoryResponse, UseEventHistoryOptions } from './useEventHistory'
export { useTraceECL, traceECLQueryKey } from './useTraceECL'
export type { ECLTraceResult, ECLSourceEvent } from './useTraceECL'
export { useTraceAccrual, traceAccrualQueryKey } from './useTraceAccrual'
export type { AccrualTraceResult, AccrualSourceEvent } from './useTraceAccrual'

// Contact Notes hooks (E7)
export { useContactNotes, contactNotesQueryKey } from './useContactNotes'
export type { ContactNoteData, ContactNotesFilters, ContactNotesResult } from './useContactNotes'

// Re-export types from canonical location
export type {
  CustomerSearchResult,
  CustomerSearchResponse,
  SearchResponse,
  LoanAccountSearchResult,
  LoanAccountSearchResponse,
} from '@/types/search'
