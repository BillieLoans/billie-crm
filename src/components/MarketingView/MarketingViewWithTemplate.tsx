import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { redirect } from 'next/navigation'
import React from 'react'
import { canReadMarketing } from '@/lib/access'
import { MarketingView } from './MarketingView'

/**
 * Marketing view for Payload admin (Task C6).
 *
 * Uses DefaultTemplate to render with the Payload sidebar and navigation.
 * This is a server component that receives AdminViewServerProps from
 * Payload's RootPage. Gated on `canReadMarketing` — the marketing role plus
 * the existing servicing roles (never `service`, an API-only account).
 */
export async function MarketingViewWithTemplate({
  initPageResult,
  params,
  searchParams,
}: AdminViewServerProps) {
  if (!initPageResult?.req?.user) {
    redirect('/admin/login?invalidate')
  }
  if (!canReadMarketing(initPageResult.req.user)) {
    redirect('/admin')
  }
  const resolvedParams = await params
  const segments = resolvedParams?.segments as string[] | undefined
  // /marketing → grid; /marketing/contacts/<id> → detail; /marketing/feedback → queue
  const contactId = segments?.[1] === 'contacts' ? (segments?.[2] ?? '') : ''
  const feedback = segments?.[1] === 'feedback'

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
      <MarketingView contactId={contactId} feedback={feedback} />
    </DefaultTemplate>
  )
}

export default MarketingViewWithTemplate
