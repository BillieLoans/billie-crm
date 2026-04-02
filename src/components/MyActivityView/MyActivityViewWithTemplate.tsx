import type { AdminViewServerProps } from 'payload'

import { DefaultTemplate } from '@payloadcms/next/templates'
import { redirect } from 'next/navigation'
import React from 'react'
import { MyActivityView } from './index'

/**
 * My Activity view for Payload admin.
 * 
 * Uses DefaultTemplate to render with the Payload sidebar and navigation.
 * This is a server component that receives AdminViewServerProps from Payload's RootPage.
 *
 * Story 6.6: User Menu Enhancements
 */
export async function MyActivityViewWithTemplate({
  initPageResult,
  params,
  searchParams,
}: AdminViewServerProps) {
  // Guard: redirect to login if not authenticated
  if (!initPageResult?.req?.user) {
    redirect('/admin/login?invalidate')
  }

  const user = initPageResult.req.user
  const userId = user?.id ? String(user.id) : undefined

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
      <MyActivityView userId={userId} />
    </DefaultTemplate>
  )
}

export default MyActivityViewWithTemplate
