/**
 * The keyboard shortcuts list carries the switch that turns single-key
 * shortcuts off across the CRM (WCAG 2.1.4), and a list's j/k obey it.
 */
import React from 'react'
import { render, renderHook, screen, fireEvent, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/ui/Modal', () => ({
  Modal: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div role="dialog" aria-label={title}>
      {children}
    </div>
  ),
}))

import { ShortcutsCheatsheet } from '@/components/AccountsBrowserView/ShortcutsCheatsheet'
import { useListKeyboardNav } from '@/hooks/useListKeyboardNav'
import { setSingleKeyShortcutsEnabled, singleKeyShortcutsEnabled } from '@/lib/keyboard'

afterEach(() => setSingleKeyShortcutsEnabled(true))

describe('ShortcutsCheatsheet', () => {
  it('turns single-key shortcuts off and on', () => {
    render(<ShortcutsCheatsheet isOpen onClose={() => undefined} />)
    const box = screen.getByLabelText(/Single-key shortcuts/)
    expect(box).toBeChecked()
    fireEvent.click(box)
    expect(singleKeyShortcutsEnabled()).toBe(false)
    expect(box).not.toBeChecked()
    fireEvent.click(box)
    expect(singleKeyShortcutsEnabled()).toBe(true)
  })
})

describe('useListKeyboardNav with single-key shortcuts off', () => {
  it('ignores j but still follows the arrow keys', () => {
    setSingleKeyShortcutsEnabled(false)
    const { result } = renderHook(() => useListKeyboardNav({ count: 3 } as never))
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j' }))
    })
    expect(result.current.index).toBe(-1)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    })
    expect(result.current.index).toBe(0)
  })
})
