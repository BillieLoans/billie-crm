'use client'

import React, { useId, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useReportBoards } from '@/hooks/queries/useReportBoards'
import { useCreateBoard } from '@/hooks/mutations/useReportBoardMutations'
import styles from './styles.module.css'

/** Every board the signed-in user can open; authors can start one. */
export function BoardsPage({ canAuthor }: { canAuthor: boolean }) {
  const id = useId().replace(/:/g, '')
  const router = useRouter()
  const boards = useReportBoards()
  const create = useCreateBoard()
  const [title, setTitle] = useState('')

  const onCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (create.isPending || !title.trim()) return
    create.mutate(
      { title },
      { onSuccess: (board) => router.push(`/admin/reports/boards/${board.slug}`) },
    )
  }

  return (
    <section aria-labelledby={`${id}-title`} data-testid="boards-page">
      <header className={styles.header}>
        <h1 id={`${id}-title`} className={styles.title}>
          Boards
        </h1>
        <p className={styles.subtitle}>
          Several reports on one page and one period, for a team&apos;s regular review.
        </p>
      </header>
      {boards.isLoading ? (
        <p className={styles.note}>Loading…</p>
      ) : boards.error ? (
        <p className={styles.errorSummary} role="alert">
          {(boards.error as Error).message}
        </p>
      ) : (boards.data ?? []).length === 0 ? (
        <p className={styles.note} data-testid="boards-empty">
          There are no boards yet.
          {canAuthor ? ' Start one below, then add reports from their pages.' : ''}
        </p>
      ) : (
        <ul className={styles.boardCards}>
          {(boards.data ?? []).map((b) => (
            <li key={b.slug} className={styles.boardTile}>
              <Link className={styles.textLink} href={`/admin/reports/boards/${b.slug}`}>
                <strong>{b.title}</strong>
              </Link>
              {b.description && <p className={styles.subscriptionMeta}>{b.description}</p>}
              <p className={styles.subscriptionMeta}>
                {b.tiles} report{b.tiles === 1 ? '' : 's'}
              </p>
            </li>
          ))}
        </ul>
      )}
      {canAuthor && (
        <form className={styles.publishBox} onSubmit={onCreate} data-testid="new-board">
          <h2 className={styles.sectionTitle}>New board</h2>
          {create.error && (
            <p className={styles.errorSummary} role="alert">
              {(create.error as Error).message}
            </p>
          )}
          <div className={styles.field}>
            <label htmlFor={`${id}-new`} className={styles.fieldLabel}>
              Title
            </label>
            <input
              id={`${id}-new`}
              className={styles.input}
              value={title}
              maxLength={120}
              placeholder="For example: Weekly credit review"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.primaryButton}
              aria-disabled={create.isPending || !title.trim()}
            >
              {create.isPending ? 'Creating…' : 'Create the board'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
