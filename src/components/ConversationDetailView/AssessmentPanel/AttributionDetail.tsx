import type { Attribution } from '@/lib/schemas/conversations'

export interface AttributionDetailProps {
  attribution: Attribution | null
}

const ROWS: Array<[label: string, key: keyof Attribution]> = [
  ['Source', 'utmSource'],
  ['Medium', 'utmMedium'],
  ['Campaign', 'utmCampaign'],
  ['Keyword', 'utmTerm'],
  ['Match type', 'matchtype'],
  ['Content', 'utmContent'],
  ['Click ID (gclid)', 'gclid'],
  ['Click ID (gbraid)', 'gbraid'],
  ['Click ID (wbraid)', 'wbraid'],
  ['Captured', 'capturedAt'],
]

/**
 * BTB-404 / BTB-500: where this application came from — an ad click, or a
 * search engine, LLM assistant, social network or other site inferred from
 * the referrer. Values are untrusted URL input, so they are rendered as plain
 * text nodes only.
 */
export function AttributionDetail({ attribution }: AttributionDetailProps) {
  if (!attribution) return <p>No source recorded: direct or untracked traffic.</p>
  return (
    <dl>
      {ROWS.filter(([, key]) => attribution[key]).map(([label, key]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd style={{ overflowWrap: 'anywhere' }}>{attribution[key]}</dd>
        </div>
      ))}
    </dl>
  )
}
