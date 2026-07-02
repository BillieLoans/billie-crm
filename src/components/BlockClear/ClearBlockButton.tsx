'use client'

import React, { useState } from 'react'
import { useAuth } from '@payloadcms/ui'
import { canService } from '@/lib/access'
import { CLEARABLE_REASONS } from '@/lib/events/config'
import type { ClearableReason } from '@/lib/events/config'
import { ClearBlockModal } from './ClearBlockModal'
import styles from './BlockClear.module.css'

export interface ClearBlockButtonProps {
  block?: {
    reason?: string | null
    canonicalCustomerId?: string | null
    clearStatus?: string | null
    clearedAt?: string | null
  } | null
  conversationId?: string
  customerName?: string
  /** Compact pill styling for inline placement (e.g. in the attention strip). */
  inline?: boolean
}

/**
 * Inline trigger for the Clear-block workflow.
 *
 * Role gate: only admin, supervisor, and operations users see this button.
 * Visible only when a block has an uncleared reason.
 *
 * If the current block reason is not clearable by operators
 * (e.g. ACTIVE_LOAN, PEP, IDENTITY_CONFLICT) the button is rendered
 * disabled with an explanatory tooltip rather than hidden.
 *
 * If a clear request is already pending or was previously rejected, a status
 * label is shown alongside the button.
 */
export function ClearBlockButton({
  block,
  conversationId,
  customerName,
  inline = false,
}: ClearBlockButtonProps) {
  const { user } = useAuth()
  const [modalOpen, setModalOpen] = useState(false)

  // Role gate — only canService roles (admin, supervisor, operations)
  if (!canService(user)) return null

  // Only render while a block reason stands. reason=NULL is the authoritative
  // "unblocked" signal. clearedAt alone must NOT hide the button: a partial
  // clear that didn't lift the currently-blocking reason (spec §14) stamps
  // clearedAt while the block remains — the retry path has to stay available.
  if (!block?.reason) return null

  const isClearable = CLEARABLE_REASONS.includes(block.reason as ClearableReason)
  const canonicalCustomerId = block.canonicalCustomerId
  const containerCls = inline
    ? `${styles.clearBlockContainer} ${styles.clearBlockContainerInline}`
    : styles.clearBlockContainer
  const btnCls = (base: string) => (inline ? `${base} ${styles.clearBlockBtnInline}` : base)

  return (
    <>
      <div className={containerCls}>
        {isClearable && canonicalCustomerId ? (
          <button
            type="button"
            className={btnCls(styles.clearBlockBtn)}
            onClick={() => setModalOpen(true)}
            data-testid="clear-block-btn"
          >
            Clear block
          </button>
        ) : isClearable && !canonicalCustomerId ? (
          <button
            type="button"
            className={btnCls(styles.clearBlockBtnDisabled)}
            disabled
            title="Customer identity not yet resolved — can't clear here."
            data-testid="clear-block-btn-disabled"
          >
            Clear block
          </button>
        ) : (
          <button
            type="button"
            className={btnCls(styles.clearBlockBtnDisabled)}
            disabled
            title="This block type can't be cleared here"
            data-testid="clear-block-btn-disabled"
          >
            Clear block
          </button>
        )}

        {block.clearStatus === 'pending' && (
          <span className={styles.clearStatusPending}>(Approval pending)</span>
        )}
        {block.clearStatus === 'rejected' && (
          <span className={styles.clearStatusRejected}>(Previously rejected)</span>
        )}
        {block.clearStatus === 'cleared' && (
          <span className={styles.clearStatusRejected}>
            (A previous clear didn&apos;t lift this reason)
          </span>
        )}
      </div>

      {isClearable && canonicalCustomerId && (
        <ClearBlockModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          canonicalCustomerId={canonicalCustomerId}
          currentReason={block.reason}
          conversationId={conversationId}
          customerName={customerName}
        />
      )}
    </>
  )
}
