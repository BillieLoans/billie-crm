import type { AdminViewServerProps } from 'payload'

import { DefaultTemplate } from '@payloadcms/next/templates'
import { redirect } from 'next/navigation'
import React from 'react'
import { ApprovalsView } from './ApprovalsView'

/**
 * Approvals view for Payload admin.
 * 
 * Uses DefaultTemplate to render with the Payload sidebar and navigation.
 * This is a server component that receives AdminViewServerProps from Payload's RootPage.
 *
 * Story 4.1: Write-Off Approval Queue
 */
export async function ApprovalsViewWithTemplate({
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
  const userId = user?.id ? String(user.id) : undefined
  const userName = user?.firstName && user?.lastName 
    ? `${user.firstName} ${user.lastName}`
    : user?.email ?? undefined

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
      <ApprovalsView 
        userRole={userRole}
        userId={userId}
        userName={userName}
      />
    </DefaultTemplate>
  )
}

export default ApprovalsViewWithTemplate
