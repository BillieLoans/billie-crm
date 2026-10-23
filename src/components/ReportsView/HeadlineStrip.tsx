'use client'

import React from 'react'
import type { HeadlineTile } from '@/lib/reports/headline'
import styles from './styles.module.css'

export interface HeadlineStripProps {
  tiles: HeadlineTile[]
  narrative?: string
  /** "previous 30 days", for the change's label. */
  previousLabel?: string
}

/**
 * The headline numbers above a report's chart, each with its change on the
 * previous period (an arrow and words, so never colour alone), and the
 * sentence that reads them.
 */
export function HeadlineStrip({ tiles, narrative, previousLabel }: HeadlineStripProps) {
  if (tiles.length === 0) return null
  return (
    <section
      className={styles.headline}
      aria-label="Headline numbers"
      data-testid="report-headline"
    >
      <dl className={styles.headlineTiles}>
        {tiles.map((tile) => (
          <div key={tile.column + tile.label} className={styles.headlineTile}>
            <dt className={styles.headlineLabel}>{tile.label}</dt>
            <dd className={styles.headlineValue}>{tile.text}</dd>
            {tile.change && (
              <dd
                className={`${styles.headlineChange} ${styles[`tone_${tile.change.tone}`]}`}
                title={tile.previousText ? `Previously ${tile.previousText}` : undefined}
              >
                <span aria-hidden="true">
                  {tile.change.direction === 'up'
                    ? '▲'
                    : tile.change.direction === 'down'
                      ? '▼'
                      : '–'}{' '}
                </span>
                {tile.change.text}
                {previousLabel ? ` on ${previousLabel}` : ''}
                {tile.change.tone !== 'neutral' && (
                  <span className={styles.visuallyHidden}>
                    {tile.change.tone === 'good' ? ' (better)' : ' (worse)'}
                  </span>
                )}
              </dd>
            )}
          </div>
        ))}
      </dl>
      {narrative && (
        <p className={styles.narrative} data-testid="report-narrative">
          {narrative}
        </p>
      )}
    </section>
  )
}
