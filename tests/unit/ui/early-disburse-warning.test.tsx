import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { EarlyDisburseWarningModal } from '@/components/PendingDisbursementsView/EarlyDisburseWarningModal'

afterEach(cleanup)

describe('EarlyDisburseWarningModal', () => {
  const baseProps = {
    isOpen: true,
    accountNumber: 'LN-20472',
    customerName: 'Eva Müller',
    loanAmountFormatted: '$450.00',
    commencementDate: '2026-06-22',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  }

  it('shows the warning and confirms', () => {
    const onConfirm = vi.fn()
    render(<EarlyDisburseWarningModal {...baseProps} onConfirm={onConfirm} />)
    expect(screen.getByText(/before the scheduled start date/i)).toBeInTheDocument()
    expect(screen.getByText(/LN-20472/)).toBeInTheDocument()
    expect(screen.getByText(/62-day/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /disburse today anyway/i }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('cancels', () => {
    const onCancel = vi.fn()
    render(<EarlyDisburseWarningModal {...baseProps} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('renders nothing when closed', () => {
    const { container } = render(<EarlyDisburseWarningModal {...baseProps} isOpen={false} />)
    expect(container).toBeEmptyDOMElement()
  })
})
