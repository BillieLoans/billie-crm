'use client'

import { useState } from 'react'
import { useAuth } from '@payloadcms/ui'
import { hasApprovalAuthority } from '@/lib/access'
import type { DeletionScope } from '@/server/statement-deletion'
import { DeleteStatementFilesDrawer } from './DeleteStatementFilesDrawer'
import styles from './DeleteStatementFilesDrawer.module.css'

export interface DeleteStatementFilesButtonProps {
  scope: DeletionScope
  label: string
  /** The drawer's title. */
  title: string
}

/**
 * Opens the statement-file deletion drawer. Self-gating: renders nothing
 * unless the user has approval authority (admin or supervisor), as the
 * deletion routes require.
 */
export function DeleteStatementFilesButton({
  scope,
  label,
  title,
}: DeleteStatementFilesButtonProps) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)

  if (!hasApprovalAuthority(user)) return null

  return (
    <>
      <button type="button" className={styles.triggerBtn} onClick={() => setOpen(true)}>
        {label}
      </button>
      <DeleteStatementFilesDrawer
        isOpen={open}
        onClose={() => setOpen(false)}
        scope={scope}
        title={title}
      />
    </>
  )
}
