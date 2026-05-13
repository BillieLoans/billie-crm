'use client'

import { PortfolioHealthWidget } from './PortfolioHealthWidget'
import { ECLSummaryWidget } from './ECLSummaryWidget'
import styles from './PortfolioHealthSection.module.css'

export function PortfolioHealthSection() {
  return (
    <section className={styles.section} data-testid="portfolio-health-section">
      <header className={styles.header}>
        <h2 className={styles.title}>Portfolio Health &amp; Risk</h2>
        <p className={styles.caption}>
          Snapshot view — used for risk reporting, not daily action.
        </p>
      </header>
      <div className={styles.grid}>
        <PortfolioHealthWidget />
        <ECLSummaryWidget />
      </div>
    </section>
  )
}
