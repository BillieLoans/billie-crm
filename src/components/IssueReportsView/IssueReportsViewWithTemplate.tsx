import type { AdminViewServerProps } from 'payload'

import { DefaultTemplate } from '@payloadcms/next/templates'
import { redirect } from 'next/navigation'
import React from 'react'
import { IssueReportsView } from './IssueReportsView'

/**
 * Issue Reports view for Payload admin (in-app problem reports).
 *
 * Uses DefaultTemplate to render with the Payload sidebar and navigation.
 * This is a server component that receives AdminViewServerProps from Payload's
 * RootPage.
 *
 * The route is a catch-all (`/issue-reports/:segments*`, see payload.config.ts)
 * so the report-detail sub-route renders here too. Payload's admin catch-all
 * (`/admin/[[...segments]]`) passes everything after `/admin/` as `segments`,
 * so for `/admin/issue-reports/<id>` that's `['issue-reports', '<id>']` — the
 * id sits at index 1 (mirrors `CollectionsViewWithTemplate`).
 *
 * Only the login guard lives here: the admin-only role gate is rendered as an
 * access-denied panel by the client view (mirrors `ApprovalsView`) rather than
 * a silent redirect, so an operator who follows a shared link is told why.
 */
export async function IssueReportsViewWithTemplate({
  initPageResult,
  params,
  searchParams,
}: AdminViewServerProps) {
  // Guard: redirect to login if not authenticated
  if (!initPageResult?.req?.user) {
    redirect('/admin/login?invalidate')
  }

  const resolvedParams = await params
  const segments = resolvedParams?.segments as string[] | undefined
  const reportId = segments?.[1] ?? ''

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
      <IssueReportsView reportId={reportId} />
    </DefaultTemplate>
  )
}

export default IssueReportsViewWithTemplate
