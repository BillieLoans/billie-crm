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
