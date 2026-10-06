import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { NetworkDetail } from '@/components/ConversationDetailView/AssessmentPanel/NetworkDetail'
import { shapeNetwork } from '@/lib/network'

const STORED = {
  country: 'AU',
  asn: '1221',
  ip: '1.1.1.1',
  received_at: '2026-10-12T01:02:04+00:00',
}

describe('NetworkDetail', () => {
  it('shows country, labelled network and recorded time', () => {
    render(<NetworkDetail network={shapeNetwork(STORED)} ip={null} />)

    expect(screen.getByText('AU')).toBeTruthy()
    expect(screen.getByText('Telstra (AS1221)')).toBeTruthy()
    expect(screen.getByText('2026-10-12T01:02:04+00:00')).toBeTruthy()
    expect(screen.queryByText('IP')).toBeNull()
  })

  it('shows the IP row only when the server sent one', () => {
    render(<NetworkDetail network={shapeNetwork(STORED)} ip="1.1.1.1" />)

    expect(screen.getByText('IP')).toBeTruthy()
    expect(screen.getByText('1.1.1.1')).toBeTruthy()
  })

  it('shows only the IP row when that is all there is', () => {
    render(<NetworkDetail network={shapeNetwork({ ip: '1.1.1.1' })} ip="1.1.1.1" />)

    expect(screen.getByText('1.1.1.1')).toBeTruthy()
    expect(screen.queryByText('Country')).toBeNull()
    expect(screen.queryByText('Network')).toBeNull()
  })

  it('labels a hosting provider', () => {
    render(<NetworkDetail network={shapeNetwork({ country: 'AU', asn: '16509' })} ip={null} />)
    expect(screen.getByText('AWS (AS16509) — hosting')).toBeTruthy()
  })

  it('says so when the conversation has no network data', () => {
    render(<NetworkDetail network={null} ip={null} />)
    expect(screen.getByText('No network data.')).toBeTruthy()
  })

  it('treats an IP-only record as no data for a reader who is not served the IP', () => {
    // Demo today: no Cloudflare headers, so only the (proxy-hop) IP and the
    // timestamp are stored. Operations must not see "Recorded" and a clock.
    render(
      <NetworkDetail
        network={shapeNetwork({ ip: '1.1.1.1', received_at: '2026-10-12T01:02:04+00:00' })}
        ip={null}
      />,
    )
    expect(screen.getByText('No network data.')).toBeTruthy()
    expect(screen.queryByText('Recorded')).toBeNull()
  })

  it('renders a hostile value as text, not markup', () => {
    const { container } = render(
      <NetworkDetail
        network={{ ...shapeNetwork({ country: 'AU' })!, asnLabel: '<img src=x>' }}
        ip={null}
      />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('<img src=x>')).toBeTruthy()
  })
})
