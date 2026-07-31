export type MutationStage = 'optimistic' | 'submitted' | 'confirmed' | 'failed'

export interface PendingMutation {
  id: string
  accountId: string
  action: string
  stage: MutationStage
  amount?: number
  createdAt: number
  error?: string
  /**
   * Account balance once this mutation settled — after confirmation, or after
   * rollback on failure. Set by the caller ONLY when the mutation actually
   * changed the balance; leaving it undefined means "nothing to report".
   */
  balanceAfter?: number
}
