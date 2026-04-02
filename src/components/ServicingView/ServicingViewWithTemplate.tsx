import type { AdminViewServerProps } from 'payload'

import { DefaultTemplate } from '@payloadcms/next/templates'
import { redirect } from 'next/navigation'
import React from 'react'
import { ServicingView } from './ServicingView'

/**
 * Servicing view for Payload admin.
 * 
 * Uses DefaultTemplate to render with the Payload sidebar and navigation.
 * This is a server component that receives AdminViewServerProps from Payload's RootPage.
 *
 * Story 2.1: Single Customer View
 */
export async function ServicingViewWithTemplate({
  initPageResult,
  params,
  searchParams,
}: AdminViewServerProps) {
  // Guard: redirect to login if not authenticated
  if (!initPageResult?.req?.user) {
    redirect('/admin/login?invalidate')
  }

  // Extract customerId from route params
  // Payload passes segments as an array: ['servicing', 'ABC123']
  // So customerId is at index 1
  const resolvedParams = await params
  const segments = resolvedParams?.segments as string[] | undefined
  const customerId = segments?.[1] ?? ''

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
      <ServicingView customerId={customerId} />
    </DefaultTemplate>
  )
}

export default ServicingViewWithTemplate
