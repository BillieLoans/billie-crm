'use client'

import React from 'react'
import { SMART_VIEWS, type SmartView } from '@/lib/smart-views'
import styles from './styles.module.css'

export interface SmartViewRailProps {
  /** id of the active Smart View, or undefined for "no view selected". */
  activeViewId: string | undefined
  onSelect: (view: SmartView) => void
}

/**
 * Left rail listing the curated Smart Views. Each is a fast switch into a
 * pre-set filter + sort combination.
 */
export const SmartViewRail: React.FC<SmartViewRailProps> = ({ activeViewId, onSelect }) => {
  return (
    <aside className={styles.rail} aria-label="Smart views">
      <h2 className={styles.railHeading}>Smart Views</h2>
      <ul className={styles.railList}>
        {SMART_VIEWS.map((view) => {
          const isActive = view.id === activeViewId
          return (
            <li key={view.id}>
              <button
                type="button"
                className={`${styles.railItem} ${isActive ? styles.active : ''}`}
                onClick={() => onSelect(view)}
                aria-current={isActive ? 'true' : undefined}
                title={view.description}
                data-testid={`smart-view-${view.id}`}
              >
                <span className={styles.railItemIcon} aria-hidden="true">
                  {view.icon}
                </span>
                <span className={styles.railItemLabel}>{view.label}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
