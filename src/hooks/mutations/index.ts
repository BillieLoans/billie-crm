// Mutation hooks barrel export

// Contact Notes hooks (E7)
export { useCreateNote } from './useCreateNote'
export type { CreateNoteParams, CreateNoteResult } from './useCreateNote'
export { useAmendNote } from './useAmendNote'
export type { AmendNoteParams } from './useAmendNote'

export { useWaiveFee } from './useWaiveFee'
export type { WaiveFeeParams, WaiveFeeResponse } from './useWaiveFee'

export { useRecordRepayment } from './useRecordRepayment'
export type {
  RecordRepaymentParams,
  RecordRepaymentResponse,
  RepaymentAllocation,
} from './useRecordRepayment'

// Collections operator action hooks (BTB-198 WS5)
export { useFlagHardship } from './useFlagHardship'
export type { FlagHardshipParams } from './useFlagHardship'
export { useResumeHardship } from './useResumeHardship'
export type { ResumeHardshipParams } from './useResumeHardship'
export { useApplyStopContact } from './useApplyStopContact'
export type { ApplyStopContactParams } from './useApplyStopContact'
export { useAdvanceToNextStep } from './useAdvanceToNextStep'
export type { AdvanceToNextStepParams } from './useAdvanceToNextStep'
