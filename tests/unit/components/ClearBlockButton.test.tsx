import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import { ClearBlockButton } from '@/components/BlockClear/ClearBlockButton'
import { CLEARABLE_REASONS } from '@/lib/events/config'

// Mock useAuth — return a canService-eligible user by default
vi.mock('@payloadcms/ui', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'ops-1', role: 'operations' },
  })),
}))

// canService must return true so the button renders
vi.mock('@/lib/access', () => ({
  canService: vi.fn(() => true),
}))

// Stub ClearBlockModal so it doesn't pull in heavy deps
vi.mock('@/components/BlockClear/ClearBlockModal', () => ({
  ClearBlockModal: () => <div data-testid="clear-block-modal-stub" />,
}))

afterEach(() => {
  cleanup()
})

const CLEARABLE = CLEARABLE_REASONS[0]
const NON_CLEARABLE = 'ACTIVE_LOAN'

describe('ClearBlockButton', () => {
  describe('M1 — canonical id gate', () => {
    it('renders enabled button when reason is clearable and canonicalCustomerId is present', () => {
      render(
        <ClearBlockButton
          block={{ reason: CLEARABLE, canonicalCustomerId: 'cust-123', clearedAt: null }}
          conversationId="conv-1"
        />,
      )
      expect(screen.getByTestId('clear-block-btn')).toBeInTheDocument()
      expect(screen.getByTestId('clear-block-btn')).not.toBeDisabled()
    })

    it('renders disabled button with identity-not-resolved tooltip when reason is clearable but canonicalCustomerId is absent', () => {
      render(
        <ClearBlockButton
          block={{ reason: CLEARABLE, canonicalCustomerId: null, clearedAt: null }}
          conversationId="conv-1"
        />,
      )
      const btn = screen.getByTestId('clear-block-btn-disabled')
      expect(btn).toBeDisabled()
      expect(btn).toHaveAttribute('title', "Customer identity not yet resolved — can't clear here.")
    })

    it('renders disabled button with "can\'t be cleared here" tooltip when reason is not clearable', () => {
      render(
        <ClearBlockButton
          block={{ reason: NON_CLEARABLE, canonicalCustomerId: 'cust-123', clearedAt: null }}
          conversationId="conv-1"
        />,
      )
      const btn = screen.getByTestId('clear-block-btn-disabled')
      expect(btn).toBeDisabled()
      expect(btn).toHaveAttribute('title', "This block type can't be cleared here")
    })

    it('does not mount modal when canonicalCustomerId is absent even for clearable reason', () => {
      render(
        <ClearBlockButton
          block={{ reason: CLEARABLE, canonicalCustomerId: null, clearedAt: null }}
          conversationId="conv-1"
        />,
      )
      expect(screen.queryByTestId('clear-block-modal-stub')).not.toBeInTheDocument()
    })
  })
})
