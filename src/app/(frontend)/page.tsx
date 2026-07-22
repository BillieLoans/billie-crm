import { headers as getHeaders } from 'next/headers.js'
import { redirect } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import { getPayload } from 'payload'
import React from 'react'

import config from '@/payload.config'
import billieLogo from './billie-logo-icon.png'
import './styles.css'

/**
 * Homepage - Redirects authenticated users to the dashboard.
 *
 * Story 6.7: Role-Based Collection Visibility
 * - Authenticated users are redirected to /admin/dashboard
 * - Unauthenticated users see a login prompt
 */
export default async function HomePage() {
  const headers = await getHeaders()
  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })
  const { user } = await payload.auth({ headers })

  // Redirect authenticated users to the dashboard (Story 6.7)
  if (user) {
    redirect('/admin/dashboard')
  }

  // Unauthenticated users see login prompt
  return (
    <div className="home">
      <div className="content">
        <Image
          alt="Billie Logo"
          height={72}
          priority
          src={billieLogo}
          width={72}
        />
        <h1>Welcome to Billie CRM</h1>
        <p className="subtitle">Customer servicing and support platform</p>
        <div className="links">
          <Link
            className="admin"
            href="/admin/login"
          >
            Sign In
          </Link>
        </div>
      </div>
    </div>
  )
}
