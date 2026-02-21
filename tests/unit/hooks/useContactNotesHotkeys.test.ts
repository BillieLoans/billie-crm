import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useContactNotesHotkeys } from '@/components/ServicingView/ContactNotes/useContactNotesHotkeys'

function fireKey(key: string, modifiers: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  })
  document.dispatchEvent(event)
  return event
}

describe('useContactNotesHotkeys', () => {
  const onOpenDrawer = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Unmount all renderHook instances to remove event listeners before next test
    cleanup()
    vi.restoreAllMocks()
  })

  describe('N key — open drawer', () => {
    it('should call onOpenDrawer when N is pressed and drawer is closed', () => {
      renderHook(() =>
        useContactNotesHotkeys({ isDrawerOpen: false, onOpenDrawer })
      )

      fireKey('n')
      expect(onOpenDrawer).toHaveBeenCalledTimes(1)
    })

    it('should call onOpenDrawer when uppercase N is pressed', () => {
      renderHook(() =>
        useContactNotesHotkeys({ isDrawerOpen: false, onOpenDrawer })
      )

      fireKey('N')
      expect(onOpenDrawer).toHaveBeenCalledTimes(1)
    })

    it('should NOT call onOpenDrawer when drawer is already open', () => {
      renderHook(() =>
        useContactNotesHotkeys({ isDrawerOpen: true, onOpenDrawer })
      )

      fireKey('n')
      expect(onOpenDrawer).not.toHaveBeenCalled()
    })

    it('should NOT call onOpenDrawer when Cmd+N is pressed', () => {
      renderHook(() =>
        useContactNotesHotkeys({ isDrawerOpen: false, onOpenDrawer })
      )

      fireKey('n', { metaKey: true })
      expect(onOpenDrawer).not.toHaveBeenCalled()
    })

    it('should NOT call onOpenDrawer when Ctrl+N is pressed', () => {
      renderHook(() =>
        useContactNotesHotkeys({ isDrawerOpen: false, onOpenDrawer })
      )

      fireKey('n', { ctrlKey: true })
      expect(onOpenDrawer).not.toHaveBeenCalled()
    })

    it('should NOT call onOpenDrawer when Alt+N is pressed', () => {
      renderHook(() =>
        useContactNotesHotkeys({ isDrawerOpen: false, onOpenDrawer })
      )

      fireKey('n', { altKey: true })
      expect(onOpenDrawer).not.toHaveBeenCalled()
    })
  })

  describe('Input suppression', () => {
    function setupInputFocus(tagName: 'INPUT' | 'TEXTAREA' | 'SELECT') {
      const el = document.createElement(tagName.toLowerCase() as keyof HTMLElementTagNameMap)
      document.body.appendChild(el)
      el.focus()
      return () => document.body.removeChild(el)
    }

    it('should NOT open drawer when N is pressed inside an INPUT', () => {
      const removeEl = setupInputFocus('INPUT')
      renderHook(() =>
        useContactNotesHotkeys({ isDrawerOpen: false, onOpenDrawer })
      )

      // Dispatch directly from the element so event.target is naturally the input
      const input = document.querySelector('input')!
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true }))

      expect(onOpenDrawer).not.toHaveBeenCalled()
      removeEl()
    })

    it('should NOT open drawer when N is pressed inside a TEXTAREA', () => {
      const removeEl = setupInputFocus('TEXTAREA')
      renderHook(() =>
        useContactNotesHotkeys({ isDrawerOpen: false, onOpenDrawer })
      )

      const textarea = document.querySelector('textarea')!
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true }))

      expect(onOpenDrawer).not.toHaveBeenCalled()
      removeEl()
    })

    it('should NOT open drawer when N is pressed inside a SELECT', () => {
      const removeEl = setupInputFocus('SELECT')
      renderHook(() =>
        useContactNotesHotkeys({ isDrawerOpen: false, onOpenDrawer })
      )

      const select = document.querySelector('select')!
      select.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true }))

      expect(onOpenDrawer).not.toHaveBeenCalled()
      removeEl()
    })

    it('should NOT open drawer when N is pressed in a contenteditable element', () => {
      renderHook(() =>
        useContactNotesHotkeys({ isDrawerOpen: false, onOpenDrawer })
      )

      // JSDOM's isContentEditable is unreliable; use Object.defineProperty to set a
      // mock target that explicitly reports isContentEditable = true
      const event = new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true })
      const fakeTarget = document.createElement('div')
      Object.defineProperty(fakeTarget, 'isContentEditable', { value: true, configurable: true })
      Object.defineProperty(event, 'target', { value: fakeTarget, configurable: true })
      document.dispatchEvent(event)

      expect(onOpenDrawer).not.toHaveBeenCalled()
    })
  })

  describe('Other keys', () => {
    it('should ignore unrelated keys', () => {
      renderHook(() =>
        useContactNotesHotkeys({ isDrawerOpen: false, onOpenDrawer })
      )

      fireKey('a')
      fireKey('b')
      fireKey('Enter')
      fireKey('Escape')

      expect(onOpenDrawer).not.toHaveBeenCalled()
    })
  })

  describe('Cleanup', () => {
    it('should remove the event listener on unmount', () => {
      const removeListenerSpy = vi.spyOn(document, 'removeEventListener')

      const { unmount } = renderHook(() =>
        useContactNotesHotkeys({ isDrawerOpen: false, onOpenDrawer })
      )

      unmount()

      expect(removeListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    })
  })
})
