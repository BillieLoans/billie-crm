/**
 * Finding reports by name: the Reports home search, the sidebar filter and
 * the command palette share one rule.
 */
import { REPORT_CATEGORIES } from '@/lib/schemas/reports'

interface Findable {
  title: string
  description: string | null
  category: string
}

/** Reports whose title, description or category mention every word of the query. */
export function matchReports<T extends Findable>(reports: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...reports]
  return reports.filter((r) => {
    const text = [
      r.title,
      r.description ?? '',
      REPORT_CATEGORIES.find((c) => c.value === r.category)?.label ?? '',
    ]
      .join(' ')
      .toLowerCase()
    return words.every((w) => text.includes(w))
  })
}
