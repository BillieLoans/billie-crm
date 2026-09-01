import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@payloadcms/ui', () => ({ useAuth: () => ({ user: null }) }))

import { StatusBadge } from '@/components/ApplicationsView/StatusBadge'

describe('StatusBadge', () => {
  it('renders the cancelled status with its own label', () => {
    render(<StatusBadge status="cancelled" />)
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
  })

  it('renders the expired status with its own label', () => {
    render(<StatusBadge status="expired" />)
    expect(screen.getByText('Expired')).toBeInTheDocument()
  })
})
