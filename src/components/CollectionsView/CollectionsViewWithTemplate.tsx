import type { AdminViewServerProps } from 'payload'

import { DefaultTemplate } from '@payloadcms/next/templates'
import { redirect } from 'next/navigation'
import React from 'react'
import { CollectionsView } from './CollectionsView'
import { CollectionsCaseView } from './CollectionsCaseView'

/**
 * Collections Queue / Case Detail view for Payload admin.
 *
 * Uses DefaultTemplate to render with the Payload sidebar and navigation.
 * This is a server component that receives AdminViewServerProps from Payload's RootPage.
 *
 * The route is a catch-all (`/collections-queue/:segments*`, see
 * payload.config.ts) so this also serves the case-detail sub-route
 * (BTB-197 WS4). Payload's admin catch-all (`/admin/[[...segments]]`)
 * passes everything after `/admin/` as `segments`, so for
 * `/admin/collections-queue/<accountId>` that's `['collections-queue',
 * '<accountId>']` — accountId at index 1 (mirrors
 * `ServicingViewWithTemplate`'s `segments?.[1]` for `/admin/servicing/<id>`).
 *
 * Story E1-S1: Collections Queue View Shell
 * BTB-197 WS4: case-detail sub-route + segment routing
 */
export async function CollectionsViewWithTemplate({
  initPageResult,
  params,
  searchParams,
}: AdminViewServerProps) {
  // Guard: redirect to login if not authenticated
  if (!initPageResult?.req?.user) {
    redirect('/admin/login?invalidate')
  }

  const user = initPageResult.req.user
  const userRole = (user?.role as 'admin' | 'supervisor' | 'operations' | 'readonly') ?? 'readonly'

  const resolvedParams = await params
  const segments = resolvedParams?.segments as string[] | undefined
  const accountId = segments?.[1]

  return (
    <DefaultTemplate
      i18n={initPageResult.req.i18n}
      locale={initPageResult.locale}
      params={params}
      payload={initPageResult.req.payload}
      permissions={initPageResult.permissions}
      searchParams={searchParams}
      user={user}
      visibleEntities={initPageResult.visibleEntities}
    >
      {accountId ? (
        <CollectionsCaseView accountId={accountId} userRole={userRole} />
      ) : (
        <CollectionsView />
      )}
    </DefaultTemplate>
  )
}

export default CollectionsViewWithTemplate
