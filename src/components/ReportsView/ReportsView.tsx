'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useAuth } from '@payloadcms/ui'
import { Breadcrumb } from '@/components/Breadcrumb'
import { hasAnyRole } from '@/lib/access'
import { useReports, type ReportSpec, type ReportSummary } from '@/hooks/queries/useReports'
import { useReportBoard } from '@/hooks/queries/useReportBoards'
import { DRAFT_KEY, ReportPanel, replaceQuery } from './ReportPanel'
import { AskPanel } from './AskPanel'
import { ReportsHome } from './ReportsHome'
import { ReportsNav } from './ReportsNav'
import { ReportEditor } from './ReportEditor'
import { SubscriptionsPage } from './SubscriptionsPage'
import { BoardsPage } from './BoardsPage'
import { BoardView } from './BoardView'
import { UsagePage } from './UsagePage'
import styles from './styles.module.css'

export interface ReportsViewProps {
  /** The report in the URL (`/admin/reports/<slug>`), or '' for the list. */
  slug: string
  /** `edit` at `/admin/reports/<slug>/edit`. */
  mode?: 'edit'
  /** The board at `/admin/reports/boards/<board>`. */
  board?: string
}

/**
 * Reports (BTB-506): run a report with its parameters and see the chart,
 * the table and a CSV. Authors also see drafts and can run them. Reports are definitions in the
 * `report-definitions` collection, so a new report needs no deploy.
 */
export function ReportsView({ slug, mode, board }: ReportsViewProps) {
  const { user } = useAuth()
  const allowed = hasAnyRole(user)
  const { data, isLoading, error } = useReports()
  const searchParams = useSearchParams()
  // Shared with the board page's own query: no second request.
  const boardTitle = useReportBoard(board ?? '', allowed && Boolean(board)).data?.title

  if (!allowed) {
    return (
      <div className={styles.container}>
        <div className={styles.accessDenied} data-testid="access-denied">
          <h1 className={styles.title}>You cannot open reports</h1>
          <p className={styles.subtitle}>Ask an admin if you need access.</p>
        </div>
      </div>
    )
  }

  const reports = data?.reports ?? []
  const canAuthor = data?.canAuthor ?? false
  const selected = slug ? reports.find((r) => r.slug === slug) : undefined
  const editing = slug === 'new' || mode === 'edit'

  if (editing) {
    return (
      <div className={styles.container}>
        <Breadcrumb
          items={[
            { label: 'Reports', href: '/admin/reports' },
            ...(slug === 'new'
              ? [{ label: 'New report' }]
              : [
                  { label: selected?.title ?? slug, href: `/admin/reports/${slug}` },
                  { label: 'Edit' },
                ]),
          ]}
        />
        {isLoading ? null : canAuthor ? (
          <ReportEditor key={slug} slug={slug === 'new' ? undefined : slug} reports={reports} />
        ) : (
          <div data-testid="editor-denied">
            <h1 className={styles.title}>You cannot edit reports</h1>
            <p className={styles.subtitle}>
              Admins and supervisors write reports. You can ask Claude for one from{' '}
              <Link href="/admin/reports/ask">Ask Claude</Link>.
            </p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <Breadcrumb
        items={
          selected
            ? [{ label: 'Reports', href: '/admin/reports' }, { label: selected.title }]
            : slug === 'ask'
              ? [{ label: 'Reports', href: '/admin/reports' }, { label: 'Ask Claude' }]
              : slug === 'subscriptions'
                ? [{ label: 'Reports', href: '/admin/reports' }, { label: 'Emails and alerts' }]
                : slug === 'usage'
                  ? [{ label: 'Reports', href: '/admin/reports' }, { label: 'Usage' }]
                  : slug === 'boards'
                    ? [
                        { label: 'Reports', href: '/admin/reports' },
                        ...(board
                          ? [
                              { label: 'Boards', href: '/admin/reports/boards' },
                              { label: boardTitle ?? 'Board' },
                            ]
                          : [{ label: 'Boards' }]),
                      ]
                    : [{ label: 'Reports' }]
        }
      />
      {!slug ? (
        <ReportsHome
          reports={reports}
          canAuthor={canAuthor}
          canAsk
          isLoading={isLoading}
          error={(error as Error | null) ?? null}
        />
      ) : (
        <div className={styles.layout}>
          <ReportsNav
            reports={reports}
            canAuthor={canAuthor}
            currentSlug={slug}
            isLoading={isLoading}
            error={(error as Error | null) ?? null}
          />
          <div className={styles.main}>
            {slug === 'ask' ? (
              <AskPanel
                initialQuestion={searchParams?.get('q') ?? ''}
                fromSlug={canAuthor ? (searchParams?.get('from') ?? undefined) : undefined}
                canAuthor={canAuthor}
              />
            ) : slug === 'subscriptions' ? (
              <SubscriptionsPage />
            ) : slug === 'usage' ? (
              isLoading ? null : (
                <UsagePage canAuthor={canAuthor} />
              )
            ) : slug === 'boards' ? (
              board ? (
                <BoardView key={board} slug={board} />
              ) : (
                <BoardsPage canAuthor={canAuthor} />
              )
            ) : selected ? (
              <ReportEntry key={selected.slug} report={selected} canAuthor={canAuthor} />
            ) : !isLoading && !error ? (
              <div data-testid="report-not-found">
                <h1 className={styles.title}>Report not found</h1>
                <p className={styles.subtitle}>
                  There is no published report at this link, or it is not shared with you. Choose a
                  report from the list.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

interface EntryProps {
  report: ReportSummary
  canAuthor: boolean
}

/**
 * Holds the draft switch (kept in the link for authors). Switching remounts
 * the panel, because a draft can have different parameters and a different
 * chart from the published version.
 */
function ReportEntry({ report, canAuthor }: EntryProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const draftOnly = !report.published
  const [draftMode, setDraftMode] = useState(
    draftOnly || (canAuthor && Boolean(report.draft) && searchParams?.get(DRAFT_KEY) === '1'),
  )
  const spec: ReportSpec = draftMode && report.draft ? report.draft : report
  const onDraftChange = (draft: boolean) => {
    setDraftMode(draft)
    // A different version has different parameters: start from its defaults.
    replaceQuery(pathname, draft ? `${DRAFT_KEY}=1` : '')
  }
  return (
    <ReportPanel
      key={draftMode ? 'draft' : 'published'}
      report={report}
      spec={spec}
      draft={draftMode}
      draftOnly={draftOnly}
      canAuthor={canAuthor}
      onDraftChange={onDraftChange}
    />
  )
}
