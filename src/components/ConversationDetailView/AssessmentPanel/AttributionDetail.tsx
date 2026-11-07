import type { Attribution, GoogleAdsConversionStatus } from '@/lib/schemas/conversations'
import { googleAdsConversionLine } from '@/lib/google-ads-conversions'

export interface AttributionDetailProps {
  attribution: Attribution | null
  /** BTB-546: offline conversions sent to Google Ads for this application. */
  googleAdsConversions?: GoogleAdsConversionStatus[]
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
export function AttributionDetail({
  attribution,
  googleAdsConversions = [],
}: AttributionDetailProps) {
  if (!attribution) return <p>No source recorded: direct or untracked traffic.</p>
  const fromAdClick = Boolean(attribution.gclid || attribution.gbraid || attribution.wbraid)
  return (
    <dl>
      {ROWS.filter(([, key]) => attribution[key]).map(([label, key]) => (
        <div key={key}>
          <dt>{label}</dt>
          <dd style={{ overflowWrap: 'anywhere' }}>{attribution[key]}</dd>
        </div>
      ))}
      {/* BTB-546: what Google Ads has been told about this ad click. Only an
          approval or a funded loan is ever sent. */}
      {fromAdClick && (
        <div>
          <dt>Sent to Google Ads</dt>
          <dd>
            {googleAdsConversions.length === 0 ? (
              'Nothing sent'
            ) : (
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
                {googleAdsConversions.map((row) => (
                  <li key={`${row.conversionName}-${row.action}`}>
                    {googleAdsConversionLine(row)}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      )}
    </dl>
  )
}
