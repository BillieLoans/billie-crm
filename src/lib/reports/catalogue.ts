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

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'each',
  'for',
  'from',
  'how',
  'in',
  'is',
  'it',
  'last',
  'many',
  'me',
  'much',
  'of',
  'on',
  'or',
  'over',
  'per',
  'report',
  'show',
  'the',
  'this',
  'to',
  'what',
  'which',
  'with',
  'week',
  'weeks',
  'weekly',
  'day',
  'days',
  'daily',
  'month',
  'months',
  'monthly',
  'quarter',
  'year',
  'by',
  'split',
  'broken',
  'down',
  'all',
])

/** Lower-case words with a plural "s" taken off, so "loans" meets "loan". */
function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
}

export interface ExistingMatch<T> {
  report: T
  /** Select parameters whose option the question names: open the report with these. */
  parameters: Record<string, string>
}

interface Askable extends Findable {
  parameters: ReadonlyArray<{
    name: string
    type: string
    options?: ReadonlyArray<{ value: string; label: string }>
  }>
}

/**
 * Published reports that already answer a question, best first: at least
 * two of the question's meaningful words in the report's title and
 * description, one of them in the title. A select option the question
 * names ("by ruleset") comes back as a parameter to open it with.
 */
export function findExistingReports<T extends Askable>(
  question: string,
  reports: readonly T[],
  limit = 2,
): Array<ExistingMatch<T>> {
  const asked = new Set(words(question))
  if (asked.size === 0) return []
  const scored = reports
    .map((report) => {
      const title = new Set(words(report.title))
      const body = new Set([...title, ...words(report.description ?? '')])
      const hits = [...asked].filter((w) => body.has(w))
      const titleHits = hits.filter((w) => title.has(w)).length
      return { report, score: hits.length + titleHits, hits: hits.length, titleHits }
    })
    .filter((s) => s.hits >= 2 && s.titleHits >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  return scored.map(({ report }) => {
    const parameters: Record<string, string> = {}
    for (const p of report.parameters) {
      if (p.type !== 'select') continue
      const option = p.options?.find((o) => {
        const optionWords = words(o.label)
        return optionWords.length > 0 && optionWords.every((w) => asked.has(w))
      })
      if (option) parameters[p.name] = option.value
    }
    return { report, parameters }
  })
}
