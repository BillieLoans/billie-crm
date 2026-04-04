'use client'

import React, { useState, useEffect } from 'react'
import styles from './styles.module.css'

interface FreshnessIndicatorProps {
  dataUpdatedAt: number | undefined
}

/**
 * FreshnessIndicator shows how recently the conversation grid was refreshed.
 *
 * - Hidden when data is fresh (< 10s)
 * - Grey text at 10–30s
 * - Amber text at 30–60s
 * - Amber badge after 60s
 *
 * Story 2.3: Monitoring Grid with Real-Time Polling
 */
export function FreshnessIndicator({ dataUpdatedAt }: FreshnessIndicatorProps) {
  const [ageSeconds, setAgeSeconds] = useState(0)

  useEffect(() => {
    if (!dataUpdatedAt) return
    const tick = () => setAgeSeconds(Math.floor((Date.now() - dataUpdatedAt) / 1000))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [dataUpdatedAt])

  if (!dataUpdatedAt || ageSeconds < 10) return null

  let className = styles.fresh
  let label = `Updated ${ageSeconds}s ago`

  if (ageSeconds >= 60) {
    className = styles.staleBadge
    label = `Not updated for ${Math.floor(ageSeconds / 60)}m`
  } else if (ageSeconds >= 30) {
    className = styles.stale
  }

  return (
    <span className={`${styles.indicator} ${className}`} aria-live="polite">
      {label}
    </span>
  )
}
