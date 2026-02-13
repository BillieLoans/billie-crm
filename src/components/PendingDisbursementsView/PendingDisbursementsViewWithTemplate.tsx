import type { AdminViewServerProps } from 'payload'

import { DefaultTemplate } from '@payloadcms/next/templates'
import { redirect } from 'next/navigation'
import React from 'react'
import { PendingDisbursementsView } from './PendingDisbursementsView'

export async function PendingDisbursementsViewWithTemplate({
  initPageResult,
  params,
  searchParams,
}: AdminViewServerProps) {
  if (!initPageResult?.req?.user) {
    redirect('/admin/login')
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
      <PendingDisbursementsView />
    </DefaultTemplate>
  )
}

export default PendingDisbursementsViewWithTemplate
