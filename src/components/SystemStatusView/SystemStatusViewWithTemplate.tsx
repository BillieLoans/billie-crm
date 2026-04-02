import type { AdminViewServerProps } from 'payload'

import { DefaultTemplate } from '@payloadcms/next/templates'
import { redirect } from 'next/navigation'
import React from 'react'
import { SystemStatusView } from './SystemStatusView'

/**
 * System Status view for Payload admin.
 *
 * Uses DefaultTemplate to render with the Payload sidebar and navigation.
 * This is a server component that receives AdminViewServerProps from Payload's RootPage.
 *
 * Story E1-S10: Create System Status View
 */
export async function SystemStatusViewWithTemplate({
  initPageResult,
  params,
  searchParams,
}: AdminViewServerProps) {
  // Guard: redirect to login if not authenticated
  if (!initPageResult?.req?.user) {
    redirect('/admin/login?invalidate')
  }

  const user = initPageResult.req.user

  // RBAC: Only admins can access system status
  const userRole = (user?.role as string | undefined) ?? ''
  if (userRole !== 'admin') {
    redirect('/admin/dashboard')
  }

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
      <SystemStatusView />
    </DefaultTemplate>
  )
}

export default SystemStatusViewWithTemplate
