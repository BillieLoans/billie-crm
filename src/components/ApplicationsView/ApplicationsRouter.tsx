'use client'

import React from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { ApplicationsView } from './index'
import { ConversationDetailView } from '../ConversationDetailView'
import { AssessmentDetailView } from '../ConversationDetailView/AssessmentDetailView'

/**
 * Client-side router for the Applications section.
 *
 * Reads `usePathname()` so navigation between grid → detail → assessment
 * works without needing a server component re-render.
 *
 * Payload's admin shell does not re-render catch-all server components on
 * client-side navigation, so all routing logic must live here in a client
 * component.
 *
 * Routes:
 *   /admin/applications                                            → grid
 *   /admin/applications/:conversationId                           → detail
 *   /admin/applications/:conversationId/assessment/:type          → assessment detail
 */
export function ApplicationsRouter() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Extract segments after /admin/applications/
  const base = '/admin/applications'
  const rest = pathname.startsWith(base) ? pathname.slice(base.length) : ''
  const segments = rest.split('/').filter(Boolean)

  const from = searchParams.get('from')
  const referrer = from === 'servicing' ? 'servicing' : null

  if (segments.length === 0) {
    return <ApplicationsView />
  }

  if (segments.length === 1) {
    return <ConversationDetailView conversationId={segments[0]} referrer={referrer} />
  }

  if (segments.length === 3 && segments[1] === 'assessment') {
    const type = segments[2] as 'account-conduct' | 'serviceability'
    if (type === 'account-conduct' || type === 'serviceability') {
      return <AssessmentDetailView conversationId={segments[0]} type={type} />
    }
  }

  // Fallback
  return <ApplicationsView />
}
