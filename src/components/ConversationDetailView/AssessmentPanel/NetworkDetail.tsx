import type { Network } from '@/lib/schemas/conversations'

export interface NetworkDetailProps {
  network: Network | null
  /** The client IP — present only when the route served it (supervisors and admins). */
  ip: string | null
}

/**
 * BTB-406: where this application came from on the network. Labelling only.
 * The IP row renders only when the server chose to send it; the role check
 * lives in the detail route, not here. Values are rendered as text nodes.
 */
export function NetworkDetail({ network, ip }: NetworkDetailProps) {
  if (!network && !ip) return <p>No network data.</p>
  const rows: Array<[label: string, value: string | null]> = [
    ['Country', network?.country ?? null],
    ['Network', network?.asnLabel ?? null],
    ['IP', ip],
    ['Recorded', network?.receivedAt ?? null],
  ]
  return (
    <dl>
      {rows
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd style={{ overflowWrap: 'anywhere' }}>{value}</dd>
          </div>
        ))}
    </dl>
  )
}
