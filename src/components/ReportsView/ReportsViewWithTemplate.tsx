import type { AdminViewServerProps } from 'payload'

import { DefaultTemplate } from '@payloadcms/next/templates'
import { redirect } from 'next/navigation'
import React from 'react'
import { ReportsView } from './ReportsView'

/**
 * Reports view for Payload admin (BTB-506), at `/admin/reports/<slug>`.
 *
 * A catch-all route, like `IssueReportsViewWithTemplate`: Payload passes
 * `['reports', '<slug>']` as `segments`, or `['reports', '<slug>', 'edit']`
 * for the editor (`/admin/reports/new` for a new report), and
 * `['reports', 'boards', '<board>']` for a board. `/admin/reports`
 * does not collide with Payload's reserved `/admin/collections/*`.
 *
 * Only the login guard lives here; the role gate is an explanatory panel in
 * the client view.
 */
export async function ReportsViewWithTemplate({
  initPageResult,
  params,
  searchParams,
}: AdminViewServerProps) {
  if (!initPageResult?.req?.user) {
    redirect('/admin/login?invalidate')
  }

  const resolvedParams = await params
  const segments = resolvedParams?.segments as string[] | undefined
  const slug = segments?.[1] ?? ''
  // /admin/reports/boards/<board>, or /admin/reports/<slug>/edit.
  const board = slug === 'boards' ? segments?.[2] : undefined
  const mode = slug !== 'boards' && segments?.[2] === 'edit' ? 'edit' : undefined

  return (
    <DefaultTemplate
      i18n={initPageResult.req.i18n}
      locale={initPageResult.locale}
      params={params}
      payload={initPageResult.req.payload}
      permissions={initPageResult.permissions}
      searchParams={searchParams}
      user={initPageResult.req.user}
      visibleEntities={initPageResult.visibleEntities}
    >
      <ReportsView slug={slug} mode={mode} board={board} />
    </DefaultTemplate>
  )
}

export default ReportsViewWithTemplate
