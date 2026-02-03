import type { AdminViewServerProps } from 'payload'

import { headers as getHeaders } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import React from 'react'

import config from '@/payload.config'

/**
 * Root admin redirect component.
 * 
 * Intercepts the `/admin` root route and redirects:
 * - Authenticated users → `/admin/dashboard`
 * - Unauthenticated users → `/admin/login`
 * 
 * Uses payload.auth() directly instead of initPageResult to avoid
 * inconsistent auth state in Payload's built-in route handling.
 */
export async function AdminRootRedirect(
  _props: AdminViewServerProps
) {
  // Use the same auth approach as the frontend page (which works reliably)
  const headers = await getHeaders()
  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })
  const { user } = await payload.auth({ headers })

  console.log('[AdminRootRedirect] Auth check:', { 
    hasUser: !!user, 
    userId: user?.id,
    email: user?.email 
  })

  // If authenticated, redirect to dashboard
  if (user) {
    redirect('/admin/dashboard')
  }

  // If not authenticated, redirect to login
  redirect('/admin/login')
}

export default AdminRootRedirect
