/**
 * Shape `conversations.network` (written by the event processor from
 * conversation_started, BTB-406) for the browser.
 *
 * Stored shape (jsonb, snake_case): country, asn, ip, received_at — every
 * value a short string, any of them absent.
 *
 * The IP is personal information. `shapeNetwork` never includes it; the
 * detail route serves it through `networkIpOf` to supervisors only.
 */

import type { Network } from '@/lib/schemas/conversations'

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/**
 * Static labels for the ASNs staff will see most: the major Australian
 * carriers, and the cloud/hosting providers an AU-exit VPN or proxy tends to
 * sit on. A label, not a score. Anything else renders as AS<n>.
 */
const ASN_LABELS: Record<string, { name: string; hosting?: true }> = {
  '1221': { name: 'Telstra' },
  '4804': { name: 'Optus' },
  '7545': { name: 'TPG' },
  '133612': { name: 'Vodafone' },
  '4764': { name: 'Aussie Broadband' },
  '4826': { name: 'Vocus' },
  '38195': { name: 'Superloop' },
  '4739': { name: 'iiNet' },
  '16509': { name: 'AWS', hosting: true },
  '14618': { name: 'AWS', hosting: true },
  '15169': { name: 'Google', hosting: true },
  '396982': { name: 'Google Cloud', hosting: true },
  '8075': { name: 'Microsoft Azure', hosting: true },
  '14061': { name: 'DigitalOcean', hosting: true },
  '16276': { name: 'OVH', hosting: true },
  '24940': { name: 'Hetzner', hosting: true },
  '63949': { name: 'Linode', hosting: true },
  '20473': { name: 'Vultr', hosting: true },
  '9009': { name: 'M247', hosting: true },
}

export function asnLabel(asn: string | null): string | null {
  if (!asn) return null
  const known = ASN_LABELS[asn]
  if (!known) return `AS${asn}`
  return known.hosting ? `${known.name} (AS${asn}) — hosting` : `${known.name} (AS${asn})`
}

function record(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as Record<string, unknown>
}

export function shapeNetwork(raw: unknown): Network | null {
  const o = record(raw)
  if (!o) return null
  const country = str(o.country)
  const asn = str(o.asn)
  if (country === null && asn === null && str(o.ip) === null) return null
  return { country, asn, asnLabel: asnLabel(asn), receivedAt: str(o.received_at) }
}

/**
 * One-line summary for the "Network" section. Only what the reader can see
 * counts: a record whose visible fields are all null (demo today: IP and
 * timestamp only) is "No data" unless the reader was served the IP.
 */
export function networkSummary(network: Network | null, ip: string | null): string {
  const visible = [network?.country, network?.asnLabel].filter(Boolean).join(' · ')
  if (visible) return visible
  return ip ? 'IP only' : 'No data'
}

/** The client IP — personal information; the route serves it to supervisors only. */
export function networkIpOf(raw: unknown): string | null {
  const o = record(raw)
  return o ? str(o.ip) : null
}
