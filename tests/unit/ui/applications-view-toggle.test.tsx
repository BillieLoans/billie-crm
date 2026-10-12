/**
 * ViewToggle — Tiles | List segmented control on the Applications header.
 * ux-standards: a toggle-button group is a named group of real buttons with
 * aria-pressed, so the pressed state is announced and reachable by Tab.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { ViewToggle } from '@/components/ApplicationsView/ViewToggle'

describe('ViewToggle', () => {
  it('exposes a named group of two pressable buttons', () => {
    render(<ViewToggle value="tiles" onChange={vi.fn()} />)
    expect(screen.getByRole('group', { name: 'View as' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tiles' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('reports the chosen layout', () => {
    const onChange = vi.fn()
    render(<ViewToggle value="tiles" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(onChange).toHaveBeenCalledWith('list')
  })

  it('does not re-report the layout already selected', () => {
    const onChange = vi.fn()
    render(<ViewToggle value="list" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'List' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
