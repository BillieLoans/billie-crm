import styles from './AgingBars.module.css'

export interface AgingBucket {
  label: string
  count: number
  amount?: number
  amountFormatted?: string
  color?: string
}

export interface AgingBarsProps {
  buckets: AgingBucket[]
  showLegend?: boolean
  testId?: string
  emptyMessage?: string
}

const DEFAULT_COLORS = ['#22c55e', '#fbbf24', '#f59e0b', '#dc2626', '#7f1d1d']

export function AgingBars({
  buckets,
  showLegend = true,
  testId,
  emptyMessage = 'No aged items',
}: AgingBarsProps) {
  const total = buckets.reduce((sum, b) => sum + b.count, 0)

  if (total === 0) {
    return (
      <div className={styles.empty} data-testid={testId}>
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className={styles.container} data-testid={testId}>
      <div
        className={styles.bar}
        role="img"
        aria-label={`${total} items distributed across ${buckets.length} aging buckets`}
      >
        {buckets.map((bucket, i) => {
          const widthPct = (bucket.count / total) * 100
          if (widthPct === 0) return null
          return (
            <div
              key={bucket.label}
              className={styles.segment}
              style={{
                width: `${widthPct}%`,
                backgroundColor: bucket.color ?? DEFAULT_COLORS[i] ?? '#888',
              }}
              title={`${bucket.label}: ${bucket.count}${
                bucket.amountFormatted ? ` (${bucket.amountFormatted})` : ''
              }`}
            />
          )
        })}
      </div>
      {showLegend && (
        <div className={styles.legend}>
          {buckets.map((bucket, i) => (
            <div key={bucket.label} className={styles.legendItem}>
              <span
                className={styles.legendSwatch}
                style={{ backgroundColor: bucket.color ?? DEFAULT_COLORS[i] ?? '#888' }}
                aria-hidden="true"
              />
              <span className={styles.legendLabel}>{bucket.label}</span>
              <span className={styles.legendCount}>{bucket.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
