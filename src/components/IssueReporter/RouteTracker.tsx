'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { recordRoute } from '@/lib/issue-diagnostics'

/**
 * Records admin navigation into the diagnostics route buffer.
 *
 * The first render is recorded too, with `from: null` — where the operator
 * landed is as much a part of the story as where they went next.
 */
export const RouteTracker: React.FC = () => {
  const pathname = usePathname()
  const previousPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!pathname) return
    const previous = previousPathRef.current
    if (previous === pathname) return

    recordRoute(previous, pathname)
    previousPathRef.current = pathname
  }, [pathname])

  return null
}

export default RouteTracker
