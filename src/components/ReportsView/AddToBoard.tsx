'use client'

import React, { useId, useState } from 'react'
import Link from 'next/link'
import { useReportBoards } from '@/hooks/queries/useReportBoards'
import { useAddBoardTile, useCreateBoard } from '@/hooks/mutations/useReportBoardMutations'
import styles from './styles.module.css'

const NEW = '__new__'

/**
 * Authors: put this report, with its settings on screen, on a board (or a
 * new one). The board's period replaces the report's own.
 */
export function AddToBoard({
  slug,
  parameters,
}: {
  slug: string
  parameters: Record<string, unknown>
}) {
  const id = useId().replace(/:/g, '')
  const [open, setOpen] = useState(false)
  const boards = useReportBoards(open)
  const add = useAddBoardTile()
  const create = useCreateBoard()
  const [choice, setChoice] = useState('')
  const [title, setTitle] = useState('')
  const [added, setAdded] = useState<{ slug: string; title: string } | null>(null)
  // The board made for this report on an earlier try whose add then failed.
  const [made, setMade] = useState<{ title: string; slug: string } | null>(null)
  const list = boards.data ?? []
  // Until the person picks, the first board (or a new one when there are
  // none); a submit fixes the choice, so a refetched list cannot change it.
  const target = choice || list[0]?.slug || NEW
  const error = (add.error ?? create.error) as Error | null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (add.isPending || create.isPending) return
    if (target === NEW && !title.trim()) return
    setChoice(target)
    try {
      let boardSlug = target
      if (target === NEW) {
        const board =
          made && made.title === title.trim() ? made : await create.mutateAsync({ title })
        setMade({ title: title.trim(), slug: board.slug })
        boardSlug = board.slug
      }
      const result = await add.mutateAsync({ board: boardSlug, report: slug, parameters })
      setAdded({ slug: result.slug, title: result.title })
      setMade(null)
      setChoice('')
      setTitle('')
      setOpen(false)
    } catch {
      // Shown from the mutation's error.
    }
  }

  return (
    <>
      <button
        type="button"
        className={styles.linkButton}
        aria-expanded={open}
        aria-controls={`${id}-form`}
        onClick={() => {
          setAdded(null)
          setOpen((o) => !o)
        }}
      >
        Add to board…
      </button>
      <span className={styles.hint} aria-live="polite">
        {added && (
          <>
            Added to{' '}
            <Link className={styles.textLink} href={`/admin/reports/boards/${added.slug}`}>
              {added.title}
            </Link>
            .
          </>
        )}
      </span>
      {open && (
        <form
          id={`${id}-form`}
          className={styles.publishBox}
          onSubmit={submit}
          data-testid="add-to-board"
        >
          {error && (
            <p className={styles.errorSummary} role="alert">
              {error.message}
            </p>
          )}
          <div className={styles.field}>
            <label htmlFor={`${id}-board`} className={styles.fieldLabel}>
              Board
            </label>
            <select
              id={`${id}-board`}
              className={styles.input}
              value={target}
              onChange={(e) => setChoice(e.target.value)}
            >
              {list.map((b) => (
                <option key={b.slug} value={b.slug}>
                  {b.title}
                </option>
              ))}
              <option value={NEW}>A new board…</option>
            </select>
          </div>
          {target === NEW && (
            <div className={styles.field}>
              <label htmlFor={`${id}-title`} className={styles.fieldLabel}>
                New board&apos;s title
              </label>
              <input
                id={`${id}-title`}
                className={styles.input}
                value={title}
                maxLength={120}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          )}
          <p className={styles.hint}>
            With the settings on screen; the board&apos;s period replaces the report&apos;s.
          </p>
          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.primaryButton}
              aria-disabled={add.isPending || create.isPending || (target === NEW && !title.trim())}
            >
              {add.isPending || create.isPending ? 'Adding…' : 'Add it'}
            </button>
            <button type="button" className={styles.secondaryButton} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </>
  )
}
