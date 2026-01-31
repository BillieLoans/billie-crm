import type { AdminViewServerProps } from 'payload'

import { DefaultTemplate } from '@payloadcms/next/templates'
import { redirect } from 'next/navigation'
import React from 'react'
import { InvestigationView } from './InvestigationView'

/**
 * Investigation View wrapped in Payload admin template.
 * Registered as a custom view in payload.config.ts.
 *
 * This is a server component that receives AdminViewServerProps from Payload's RootPage.
 */
export async function InvestigationViewWithTemplate({
  initPageResult,
  params,
  searchParams,
}: AdminViewServerProps) {
  // Guard: redirect to login if not authenticated
  if (!initPageResult?.req?.user) {
    redirect('/admin/login')
  }

  const userId = initPageResult.req.user?.id?.toString()
  
  // Extract query params for initial state
  const resolvedSearchParams = await searchParams
  const initialAccountId = typeof resolvedSearchParams?.accountId === 'string' 
    ? resolvedSearchParams.accountId 
    : undefined
  const initialTab = typeof resolvedSearchParams?.tab === 'string'
    ? (resolvedSearchParams.tab as 'events' | 'ecl-trace' | 'accrual-trace')
    : undefined
  const initialStreamFilter = typeof resolvedSearchParams?.stream === 'string'
    ? resolvedSearchParams.stream
    : undefined

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
      <InvestigationView 
        userId={userId} 
        initialAccountId={initialAccountId}
        initialTab={initialTab}
        initialStreamFilter={initialStreamFilter}
      />
    </DefaultTemplate>
  )
}

export default InvestigationViewWithTemplate
