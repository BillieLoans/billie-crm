// Hooks barrel export
export { useGlobalHotkeys, useCommandPaletteHotkeys } from './useGlobalHotkeys'
export { useTrackCustomerView } from './useTrackCustomerView'
export { useCustomerSearch } from './queries/useCustomerSearch'
export { useLoanAccountSearch } from './queries/useLoanAccountSearch'
export { useCustomer } from './queries/useCustomer'
export type { CustomerData } from './queries/useCustomer'
export { useAccountsBrowser, accountsBrowserQueryKey } from './queries/useAccountsBrowser'
export type {
  AccountsBrowserResponse,
  UseAccountsBrowserOptions,
} from './queries/useAccountsBrowser'

// Mutations
export { useWaiveFee } from './mutations/useWaiveFee'
export type { WaiveFeeParams, WaiveFeeResponse } from './mutations/useWaiveFee'
export { useRecordRepayment } from './mutations/useRecordRepayment'
export type {
  RecordRepaymentParams,
  RecordRepaymentResponse,
  RepaymentAllocation,
} from './mutations/useRecordRepayment'

// Collections operator action mutations (BTB-198 WS5)
export { useFlagHardship } from './mutations/useFlagHardship'
export type { FlagHardshipParams } from './mutations/useFlagHardship'
export { useResumeHardship } from './mutations/useResumeHardship'
export type { ResumeHardshipParams } from './mutations/useResumeHardship'
export { useApplyStopContact } from './mutations/useApplyStopContact'
export type { ApplyStopContactParams } from './mutations/useApplyStopContact'
export { useAdvanceToNextStep } from './mutations/useAdvanceToNextStep'
export type { AdvanceToNextStepParams } from './mutations/useAdvanceToNextStep'

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
export type {
  CreateExportJobRequest,
  CreateExportJobResponse,
} from './mutations/useCreateExportJob'
export { useRetryExport } from './mutations/useRetryExport'

// Investigation mutations (E6)
export { useBatchQuery } from './mutations/useBatchQuery'
export type {
  BatchQueryRequest,
  BatchQueryAccountResult,
  BatchQueryResponse,
} from './mutations/useBatchQuery'
export { useRandomSample } from './mutations/useRandomSample'
export type { RandomSampleRequest, RandomSampleResponse } from './mutations/useRandomSample'

// Conversations queries (billie-crm-applications)
export { useConversations, useCustomerConversations } from './queries/useConversations'
export { useConversation } from './queries/useConversation'
export { useLlmCosts } from './queries/useLlmCosts'
export {
  useAccountConductAssessment,
  useServiceabilityAssessment,
  usePostIdentityRiskAssessment,
} from './queries/useAssessments'
export { useStatementFile, rawStatementFileUrl } from './queries/useStatementFile'
export type { StatementSlot, StatementFileContent, CsvData } from './queries/useStatementFile'

// Notifications (E-notifications)
export { useNotifications } from './queries/useNotifications'
export type {
  NotificationData,
  NotificationStatus,
  NotificationsFilters,
} from './queries/useNotifications'
export { useNotificationSuppression } from './queries/useNotificationSuppression'
export type { SuppressionData } from './queries/useNotificationSuppression'
export { useNotificationBody, NotificationBodyNotFoundError } from './queries/useNotificationBody'
export type { NotificationBodyData } from './queries/useNotificationBody'
export { useSetNotificationSuppression } from './mutations/useSetNotificationSuppression'
export type { SetSuppressionParams } from './mutations/useSetNotificationSuppression'
export { useClearNotificationSuppression } from './mutations/useClearNotificationSuppression'

// Block-Clear mutations (B3)
export { useRequestBlockClear } from './mutations/useRequestBlockClear'
export type { RequestBlockClearParams } from './mutations/useRequestBlockClear'
export { useApproveBlockClear } from './mutations/useApproveBlockClear'
export type {
  ApproveBlockClearParams,
  ApproveBlockClearResult,
} from './mutations/useApproveBlockClear'
export { useRejectBlockClear } from './mutations/useRejectBlockClear'
export type {
  RejectBlockClearParams,
  RejectBlockClearResult,
} from './mutations/useRejectBlockClear'
export { useCancelBlockClear } from './mutations/useCancelBlockClear'
export type {
  CancelBlockClearParams,
  CancelBlockClearResult,
} from './mutations/useCancelBlockClear'

// Block-Clear queries (B3)
export { usePendingBlockClears } from './queries/usePendingBlockClears'
export type { BlockClearRequest, PendingBlockClearsOptions } from './queries/usePendingBlockClears'

// Applicant Release queries & mutations
export {
  useReleases,
  useRelease,
  releasesQueryKey,
  releaseDetailQueryKey,
} from './queries/useReleases'
export type {
  ReleasesResponse,
  ReleaseDetailResponse,
  ReleaseWithDerived,
} from './queries/useReleases'
export { useGateStatus, gateStatusQueryKey } from './queries/useGateStatus'
export type { GateStatus } from './queries/useGateStatus'
export {
  useCreateRelease,
  useRevokeRelease,
  useReleasePreflight,
  useSetGateMode,
} from './mutations/useReleaseCommands'
export type { ReleasePreflightResult, SetGateModeVars } from './mutations/useReleaseCommands'

// Issue reports queries & mutations (in-app problem reports)
export {
  useIssueReports,
  useOpenIssueCount,
  useIssueReport,
  issueReportsKeys,
} from './queries/useIssueReports'
export type { IssueReport, IssueReportsResponse } from './queries/useIssueReports'
export { useReportIssue } from './mutations/useReportIssue'
export type { ReportIssueParams, ReportIssueResult } from './mutations/useReportIssue'
export { useResolveIssue } from './mutations/useResolveIssue'
export type { ResolveIssueParams, ResolveIssueResult } from './mutations/useResolveIssue'

// Conversation-kill mutation (End conversation)
export { useKillConversation } from './mutations/useKillConversation'
export type { KillConversationResult } from './mutations/useKillConversation'

export { useLendingAccess } from './useLendingAccess'

// Re-export types from canonical location
export type {
  CustomerSearchResult,
  CustomerSearchResponse,
  SearchResponse,
  LoanAccountSearchResult,
  LoanAccountSearchResponse,
} from '@/types/search'
