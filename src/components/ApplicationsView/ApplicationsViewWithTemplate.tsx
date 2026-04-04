import type { AdminViewServerProps } from 'payload'

import { DefaultTemplate } from '@payloadcms/next/templates'
import { redirect } from 'next/navigation'
import React from 'react'
import { ApplicationsRouter } from './ApplicationsRouter'

/**
 * ApplicationsView server wrapper — renders within the Payload admin template.
 *
 * Routing (grid → detail → assessment) is handled client-side in ApplicationsRouter
 * using usePathname() because Payload's admin shell does not re-render catch-all
 * server components on client-side navigation within the same route pattern.
 *
 * Story 2.1: ApplicationsView Scaffold & Navigation (FR37)
 */
export async function ApplicationsViewWithTemplate({
  initPageResult,
  params,
  searchParams,
}: AdminViewServerProps) {
  if (!initPageResult?.req?.user) {
    redirect('/admin/login?invalidate')
  }

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
      <ApplicationsRouter />
    </DefaultTemplate>
  )
}

export default ApplicationsViewWithTemplate
