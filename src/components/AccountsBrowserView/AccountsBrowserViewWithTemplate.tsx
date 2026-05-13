import type { AdminViewServerProps } from 'payload'

import { DefaultTemplate } from '@payloadcms/next/templates'
import { redirect } from 'next/navigation'
import React from 'react'
import { AccountsBrowserView } from './AccountsBrowserView'

/**
 * Browse Accounts view, wrapped in the Payload admin template so it renders
 * with the sidebar and header. Server component — receives
 * `AdminViewServerProps` from Payload's `RootPage`.
 */
export async function AccountsBrowserViewWithTemplate({
  initPageResult,
  params,
  searchParams,
}: AdminViewServerProps) {
  if (!initPageResult?.req?.user) {
    redirect('/admin/login?invalidate')
  }

  const user = initPageResult.req.user

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
      <AccountsBrowserView />
    </DefaultTemplate>
  )
}

export default AccountsBrowserViewWithTemplate
