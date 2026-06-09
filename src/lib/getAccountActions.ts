// src/lib/getAccountActions.ts
import type { LoanAccountData } from '@/hooks/queries/useCustomer'

export type AccountActionId =
  | 'disburse'
  | 'record-payment'
  | 'waive-fee'
  | 'apply-late-fee'
  | 'apply-dishonour-fee'
  | 'request-write-off'

export interface AccountActionContext {
  readOnly: boolean
  hasPendingWriteOff: boolean
  pendingRepayment: boolean
  pendingWaive: boolean
}

export interface AccountAction {
  id: AccountActionId
  label: string
  visible: boolean
  enabled: boolean
  primary: boolean
  danger: boolean
  disabledReason: string | null
}

const PENDING_REASON = 'Available after the loan is disbursed'
const READONLY_REASON = 'Read-only mode'

/**
 * Single source of truth for account action availability.
 * Ported verbatim from ActionsTab/RecordRepaymentDrawer, plus the
 * pending_disbursement gating (all money actions disabled until disbursed).
 */
export function getAccountActions(
  account: LoanAccountData,
  ctx: AccountActionContext,
): AccountAction[] {
  const isPending = account.accountStatus === 'pending_disbursement'
  const fees = account.liveBalance ? account.liveBalance.feeBalance : 0

  // Resolve a disabledReason in precedence order; null means enabled.
  const reason = (extra: () => string | null): string | null => {
    if (ctx.readOnly) return READONLY_REASON
    if (isPending) return PENDING_REASON
    return extra()
  }

  const disburse: AccountAction = {
    id: 'disburse',
    label: 'Disburse loan',
    visible: isPending,
    primary: isPending,
    danger: false,
    disabledReason: ctx.readOnly ? READONLY_REASON : null,
    enabled: isPending && !ctx.readOnly,
  }

  const recordPayment: AccountAction = mk('record-payment', 'Record payment', {
    primary: !isPending,
    disabledReason: reason(() => (ctx.pendingRepayment ? 'Payment in progress' : null)),
  })

  const waiveFee: AccountAction = mk('waive-fee', 'Waive fee', {
    disabledReason: reason(() =>
      ctx.pendingWaive ? 'Waive in progress' : fees <= 0 ? 'No fees to waive' : null,
    ),
  })

  const lateFee = mk('apply-late-fee', 'Apply late fee', { disabledReason: reason(() => null) })
  const dishonourFee = mk('apply-dishonour-fee', 'Apply dishonour fee', { disabledReason: reason(() => null) })

  const writeOff = mk('request-write-off', 'Request write-off', {
    danger: true,
    disabledReason: reason(() =>
      ctx.hasPendingWriteOff ? 'Write-off already pending approval' : null,
    ),
  })

  return [disburse, recordPayment, waiveFee, lateFee, dishonourFee, writeOff]
}

function mk(
  id: AccountActionId,
  label: string,
  opts: { primary?: boolean; danger?: boolean; disabledReason: string | null },
): AccountAction {
  return {
    id,
    label,
    visible: true,
    primary: opts.primary ?? false,
    danger: opts.danger ?? false,
    disabledReason: opts.disabledReason,
    enabled: opts.disabledReason === null,
  }
}
