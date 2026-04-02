import type { AdminViewServerProps } from 'payload'

import { DefaultTemplate } from '@payloadcms/next/templates'
import { redirect } from 'next/navigation'
import React from 'react'
import { ECLConfigView } from './ECLConfigView'

/**
 * ECL Config View wrapped in Payload admin template.
 * Registered as a custom view in payload.config.ts.
 *
 * This is a server component that receives AdminViewServerProps from Payload's RootPage.
 */
export async function ECLConfigViewWithTemplate({
  initPageResult,
  params,
  searchParams,
}: AdminViewServerProps) {
  // Guard: redirect to login if not authenticated
  if (!initPageResult?.req?.user) {
    redirect('/admin/login?invalidate')
  }

  const userId = initPageResult.req.user?.id?.toString()

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
      <ECLConfigView userId={userId} />
    </DefaultTemplate>
  )
}

export default ECLConfigViewWithTemplate
