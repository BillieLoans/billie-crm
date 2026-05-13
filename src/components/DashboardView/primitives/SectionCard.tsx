import type { ReactNode } from 'react'
import styles from './SectionCard.module.css'

export interface SectionCardProps {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  testId?: string
  density?: 'default' | 'compact'
}

export function SectionCard({
  title,
  action,
  children,
  className,
  testId,
  density = 'default',
}: SectionCardProps) {
  const rootClass = [styles.card, density === 'compact' ? styles.compact : null, className]
    .filter(Boolean)
    .join(' ')

  return (
    <section className={rootClass} data-testid={testId}>
      {(title || action) && (
        <header className={styles.header}>
          {title && <h2 className={styles.title}>{title}</h2>}
          {action && <div className={styles.action}>{action}</div>}
        </header>
      )}
      {children}
    </section>
  )
}
