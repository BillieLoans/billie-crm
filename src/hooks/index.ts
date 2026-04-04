// Hooks barrel export
export { useGlobalHotkeys, useCommandPaletteHotkeys } from './useGlobalHotkeys'
export { useTrackCustomerView } from './useTrackCustomerView'
export { useCustomerSearch } from './queries/useCustomerSearch'
export { useLoanAccountSearch } from './queries/useLoanAccountSearch'
export { useCustomer } from './queries/useCustomer'
export type { CustomerData } from './queries/useCustomer'

// Mutations
export { useWaiveFee } from './mutations/useWaiveFee'
export type { WaiveFeeParams, WaiveFeeResponse } from './mutations/useWaiveFee'
export { useRecordRepayment } from './mutations/useRecordRepayment'
export type {
  RecordRepaymentParams,
  RecordRepaymentResponse,
  RepaymentAllocation,
} from './mutations/useRecordRepayment'

// Period Close mutations (E3)
export { usePeriodClosePreview } from './mutations/usePeriodClosePreview'
export type {
  PeriodClosePreview,
  PeriodCloseAnomaly,
  ECLBucketSummary,
} from './mutations/usePeriodClosePreview'
export { useAcknowledgeAnomaly } from './mutations/useAcknowledgeAnomaly'
export { useFinalizePeriodClose } from './mutations/useFinalizePeriodClose'

// ECL Config mutations (E4)
export { useUpdateOverlay } from './mutations/useUpdateOverlay'
export { useUpdatePDRate } from './mutations/useUpdatePDRate'
export { useScheduleConfigChange } from './mutations/useScheduleConfigChange'
export { useCancelConfigChange } from './mutations/useCancelConfigChange'
export { useTriggerPortfolioRecalc } from './mutations/useTriggerPortfolioRecalc'

// Export Center mutations (E5)
export { useCreateExportJob } from './mutations/useCreateExportJob'
export type { CreateExportJobRequest, CreateExportJobResponse } from './mutations/useCreateExportJob'
export { useRetryExport } from './mutations/useRetryExport'

// Investigation mutations (E6)
export { useBatchQuery } from './mutations/useBatchQuery'
export type { BatchQueryRequest, BatchQueryAccountResult, BatchQueryResponse } from './mutations/useBatchQuery'
export { useRandomSample } from './mutations/useRandomSample'
export type { RandomSampleRequest, RandomSampleResponse } from './mutations/useRandomSample'

// Conversations queries (billie-crm-applications)
export { useConversations, useCustomerConversations } from './queries/useConversations'
export { useConversation } from './queries/useConversation'
export { useAccountConductAssessment, useServiceabilityAssessment } from './queries/useAssessments'

// Re-export types from canonical location
export type {
  CustomerSearchResult,
  CustomerSearchResponse,
  SearchResponse,
  LoanAccountSearchResult,
  LoanAccountSearchResponse,
} from '@/types/search'
