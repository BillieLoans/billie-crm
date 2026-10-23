'use client'

import React, { useEffect, useId, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { RANGE_PRESETS, dateRangeParameters, sydneyToday } from '@/lib/reports/periods'
import {
  BOARD_TILE_SHOWS,
  BOARD_TILE_SHOW_LABELS,
  DEFAULT_BOARD_RANGE,
  type BoardTile,
  type BoardTileShow,
} from '@/lib/reports/boards'
import { deliveryParameters } from '@/lib/reports/subscriptions'
import {
  BoardFailure,
  useReportBoard,
  type BoardView as Board,
} from '@/hooks/queries/useReportBoards'
import { useDeleteBoard, useUpdateBoard } from '@/hooks/mutations/useReportBoardMutations'
import { ReportRunFailure, useReportRun } from '@/hooks/queries/useReportRun'
import { HeadlineStrip } from './HeadlineStrip'
import { useReportHeadline } from './useReportHeadline'
import { COMPARE_KEY, replaceQuery } from './ReportPanel'
import { ReportResults } from './ReportResults'
import styles from './styles.module.css'

const PERIOD_KEY = 'period'

type TileView = Board['tiles'][number]

/** The report's own page on the board's period, with the tile's settings. */
export function tileHref(tile: TileView, rangeKey: string, compare: boolean): string {
  const values = deliveryParameters(
    tile.report.parameters,
    tile.parameters,
    rangeKey,
    sydneyToday(),
  )
  const query = new URLSearchParams()
  for (const [name, value] of Object.entries(values)) query.set(name, String(value))
  if (compare && dateRangeParameters(tile.report.parameters)) query.set(COMPARE_KEY, '1')
  const q = query.toString()
  return `/admin/reports/${tile.report.slug}${q ? `?${q}` : ''}`
}

function BoardTileCard({
  tile,
  rangeKey,
  compare,
}: {
  tile: TileView
  rangeKey: string
  compare: boolean
}) {
  const spec = tile.report
  const range = dateRangeParameters(spec.parameters)
  const hasRange = range !== null
  const parameters = useMemo(
    () => deliveryParameters(spec.parameters, tile.parameters, rangeKey, sydneyToday()),
    [spec.parameters, tile.parameters, rangeKey],
  )
  const run = useReportRun({
    slug: spec.slug,
    parameters,
    draft: false,
    compare: compare && hasRange,
    trigger: 'board',
    attempt: 0,
  })
  const result = run.data
  const { previousRows, previousLabel, tiles, narrative } = useReportHeadline(result, spec)
  // What the tile shows, by what the report has: never an empty card, and
  // never a whole table squeezed into a tile.
  const hasHeadline = spec.headline.length > 0
  const hasChart = spec.charts.length > 0
  const showHeadline = hasHeadline && (tile.show !== 'chart' || !hasChart)
  const showChart = hasChart && (tile.show !== 'headline' || !hasHeadline)

  return (
    <article
      className={styles.boardTile}
      aria-labelledby={`tile-${tile.id}`}
      data-testid={`tile-${tile.id}`}
    >
      <h2 id={`tile-${tile.id}`} className={styles.sectionTitle}>
        <Link className={styles.textLink} href={tileHref(tile, rangeKey, compare)}>
          {spec.title}
        </Link>
      </h2>
      {!hasRange && (
        <p className={styles.hint}>This report has no period of its own; it shows its defaults.</p>
      )}
      {run.isFetching && !result && (
        <p className={styles.status} aria-live="polite">
          Running…
        </p>
      )}
      {run.error && (
        <p className={styles.fieldError}>
          {run.error instanceof ReportRunFailure
            ? run.error.message
            : 'This report could not be run.'}
        </p>
      )}
      {result && result.rowCount === 0 && <p className={styles.note}>No rows for this period.</p>}
      {result && result.rowCount > 0 && (
        <>
          {showHeadline && tiles.length > 0 && (
            <HeadlineStrip tiles={tiles} narrative={narrative} previousLabel={previousLabel} />
          )}
          {!showHeadline && !showChart && (
            <p className={styles.note}>
              This report is a table. Open it to see the {result.rowCount} rows.
            </p>
          )}
          {showChart && (
            <ReportResults
              title={spec.title}
              charts={spec.charts.slice(0, 1)}
              columnSpecs={spec.columns}
              columns={result.columns}
              rows={result.rows}
              previousRows={previousRows}
              reportSlug={spec.slug}
              periodStarts={
                result.previous && range
                  ? { current: String(parameters[range.from.name]), previous: result.previous.from }
                  : undefined
              }
            />
          )}
        </>
      )}
    </article>
  )
}

/** An author's changes to a board: title, description, and the tiles' order and display. */
function BoardEditor({
  board,
  onDone,
  onReload,
}: {
  board: Board
  onDone: () => void
  /** Drop the changes and load the board as it is now. */
  onReload: () => void
}) {
  const id = useId().replace(/:/g, '')
  const update = useUpdateBoard(board.slug)
  const [title, setTitle] = useState(board.title)
  const [description, setDescription] = useState(board.description ?? '')
  const [tiles, setTiles] = useState<BoardTile[]>(() =>
    board.tiles.map((t) => ({
      id: t.id,
      report: t.report.slug,
      parameters: t.parameters,
      show: t.show,
    })),
  )
  const titleOf = (slug: string) => board.tiles.find((t) => t.report.slug === slug)?.report.title
  const move = (i: number, by: number) =>
    setTiles((list) => {
      const next = [...list]
      const [item] = next.splice(i, 1)
      next.splice(i + by, 0, item)
      return next
    })

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    if (update.isPending) return
    update.mutate({ title, description, tiles, version: board.version }, { onSuccess: onDone })
  }

  return (
    <form className={styles.publishBox} onSubmit={save} data-testid="board-editor">
      <h2 className={styles.sectionTitle}>Change this board</h2>
      {update.error && (
        <div className={styles.errorSummary} role="alert">
          <p>{(update.error as Error).message}</p>
          {update.error instanceof BoardFailure && update.error.code === 'BOARD_CHANGED' && (
            <button type="button" className={styles.secondaryButton} onClick={onReload}>
              Reload the board
            </button>
          )}
        </div>
      )}
      <div className={styles.field}>
        <label htmlFor={`${id}-title`} className={styles.fieldLabel}>
          Title
        </label>
        <input
          id={`${id}-title`}
          className={styles.input}
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor={`${id}-desc`} className={styles.fieldLabel}>
          Description
        </label>
        <textarea
          id={`${id}-desc`}
          className={styles.textarea}
          rows={2}
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      {board.hiddenTiles > 0 && (
        <p className={styles.hint}>
          {board.hiddenTiles} more {board.hiddenTiles === 1 ? 'tile is' : 'tiles are'} for reports
          that are not published now; they stay on the board and come back when the report is
          published again.
        </p>
      )}
      <ol className={styles.subscriptionList}>
        {tiles.map((tile, i) => (
          <li key={tile.id} className={styles.subscriptionItem} data-testid={`edit-tile-${i}`}>
            <strong>{titleOf(tile.report) ?? tile.report}</strong>
            <div className={styles.actions}>
              <label className={styles.visuallyHidden} htmlFor={`${id}-show-${tile.id}`}>
                Show for {titleOf(tile.report) ?? tile.report}
              </label>
              <select
                id={`${id}-show-${tile.id}`}
                className={styles.input}
                value={tile.show}
                onChange={(e) =>
                  setTiles((list) =>
                    list.map((t) =>
                      t.id === tile.id ? { ...t, show: e.target.value as BoardTileShow } : t,
                    ),
                  )
                }
              >
                {BOARD_TILE_SHOWS.map((s) => (
                  <option key={s} value={s}>
                    {BOARD_TILE_SHOW_LABELS[s]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={styles.linkButton}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                Move up
              </button>
              <button
                type="button"
                className={styles.linkButton}
                disabled={i === tiles.length - 1}
                onClick={() => move(i, 1)}
              >
                Move down
              </button>
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => setTiles((list) => list.filter((t) => t.id !== tile.id))}
              >
                Remove {titleOf(tile.report) ?? tile.report}
              </button>
            </div>
          </li>
        ))}
      </ol>
      <p className={styles.hint}>Add reports from their own pages, with “Add to board”.</p>
      <div className={styles.actions}>
        <button type="submit" className={styles.primaryButton} aria-disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save the board'}
        </button>
        <button type="button" className={styles.secondaryButton} onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/**
 * A board: report tiles on one shared period, each its headline numbers
 * and first chart, linking to the report on the same period. The period is
 * kept in the link, so a board view can be shared.
 */
export function BoardView({ slug }: { slug: string }) {
  const id = useId().replace(/:/g, '')
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [deleted, setDeleted] = useState(false)
  // Not refetched once deleted: the page is on its way out.
  const query = useReportBoard(slug, !deleted)
  const remove = useDeleteBoard()
  const [rangeKey, setRangeKey] = useState(() => {
    const fromLink = searchParams?.get(PERIOD_KEY)
    return RANGE_PRESETS.some((p) => p.key === fromLink)
      ? (fromLink as string)
      : DEFAULT_BOARD_RANGE
  })
  const [compare, setCompare] = useState(() => searchParams?.get(COMPARE_KEY) === '1')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    const q = new URLSearchParams()
    if (rangeKey !== DEFAULT_BOARD_RANGE) q.set(PERIOD_KEY, rangeKey)
    if (compare) q.set(COMPARE_KEY, '1')
    replaceQuery(pathname, q.toString())
  }, [rangeKey, compare, pathname])

  if (query.isLoading) return <p className={styles.note}>Loading the board…</p>
  if (deleted) return <p className={styles.note}>Board deleted.</p>
  if (query.error && !(query.error instanceof BoardFailure && query.error.code === 'NOT_FOUND')) {
    return (
      <div className={styles.errorSummary} role="alert" data-testid="board-error">
        <p>The board could not be loaded. Try again.</p>
        <button type="button" className={styles.secondaryButton} onClick={() => query.refetch()}>
          Try again
        </button>
      </div>
    )
  }
  if (query.error || !query.data) {
    return (
      <div data-testid="board-not-found">
        <h1 className={styles.title}>Board not found</h1>
        <p className={styles.subtitle}>
          There is no board at this link, or none of its reports are shared with you.{' '}
          <Link href="/admin/reports/boards">See all boards</Link>.
        </p>
      </div>
    )
  }
  const board = query.data

  const onDelete = () => {
    if (!window.confirm(`Delete the board "${board.title}"? Its reports are not affected.`)) return
    remove.mutate(board.slug, {
      onSuccess: () => {
        setDeleted(true)
        router.push('/admin/reports/boards')
      },
    })
  }

  return (
    <section aria-labelledby={`${id}-title`} data-testid="board-view">
      <header className={styles.header}>
        <h1 id={`${id}-title`} className={styles.title}>
          {board.title}
        </h1>
        {board.description && <p className={styles.subtitle}>{board.description}</p>}
      </header>
      {board.canEdit && !editing && (
        <div className={styles.authorBar}>
          <span className={styles.authorBarLabel}>For authors:</span>
          <button type="button" className={styles.linkButton} onClick={() => setEditing(true)}>
            Change this board
          </button>
          <button type="button" className={styles.linkButton} onClick={onDelete}>
            Delete board
          </button>
        </div>
      )}
      {editing && (
        <BoardEditor
          key={board.version}
          board={board}
          onDone={() => setEditing(false)}
          onReload={() => void query.refetch()}
        />
      )}

      <div className={styles.actions}>
        <div className={styles.field}>
          <label htmlFor={`${id}-period`} className={styles.fieldLabel}>
            Period for every report
          </label>
          <select
            id={`${id}-period`}
            className={styles.input}
            value={rangeKey}
            onChange={(e) => setRangeKey(e.target.value)}
          >
            {RANGE_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.checkboxRow}>
          <input
            id={`${id}-compare`}
            type="checkbox"
            className={styles.checkbox}
            checked={compare}
            onChange={(e) => setCompare(e.target.checked)}
          />
          <label htmlFor={`${id}-compare`} className={styles.fieldLabel}>
            Compare with the previous period
          </label>
        </div>
      </div>

      {board.tiles.length === 0 ? (
        <p className={styles.note} data-testid="board-empty">
          No reports on this board yet. Open a report and choose “Add to board”.
        </p>
      ) : (
        <div className={styles.boardGrid}>
          {board.tiles.map((tile) => (
            <BoardTileCard key={tile.id} tile={tile} rangeKey={rangeKey} compare={compare} />
          ))}
        </div>
      )}
    </section>
  )
}
