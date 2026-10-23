'use client'

import Link from 'next/link'
import { ECLSummaryWidget } from './ECLSummaryWidget'
import styles from './PortfolioHealthSection.module.css'

export function PortfolioHealthSection() {
  return (
    <section className={styles.section} data-testid="portfolio-health-section">
      <header className={styles.header}>
        <h2 className={styles.title}>Portfolio Health &amp; Risk</h2>
        <p className={styles.caption}>Snapshot view — used for risk reporting, not daily action.</p>
        <p className={styles.caption}>
          Applications, approval rate, lending and arrears, with their trends, are in{' '}
          <Link href="/admin/reports" data-testid="dashboard-reports-link">
            Reports
          </Link>
          .
        </p>
      </header>
      <div className={styles.grid}>
        <ECLSummaryWidget />
      </div>
    </section>
  )
}
