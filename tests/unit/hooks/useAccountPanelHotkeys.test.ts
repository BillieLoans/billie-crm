import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useAccountPanelHotkeys } from '@/components/ServicingView/AccountPanel/useAccountPanelHotkeys'

describe('useAccountPanelHotkeys', () => {
  let mockOnTabChange: ReturnType<typeof vi.fn>
  let mockOnSwitchAccount: ReturnType<typeof vi.fn>
  let mockOnClose: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockOnTabChange = vi.fn()
    mockOnSwitchAccount = vi.fn()
    mockOnClose = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  const createKeyboardEvent = (
    key: string,
    options: Partial<KeyboardEventInit> = {}
  ): KeyboardEvent => {
    return new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    })
  }

  const getDefaultOptions = () => ({
    activeTab: 'overview' as const,
    onTabChange: mockOnTabChange,
    accountIds: ['acc-1', 'acc-2', 'acc-3'],
    selectedAccountId: 'acc-1',
    onSwitchAccount: mockOnSwitchAccount,
    onClose: mockOnClose,
    isActive: true,
  })

  describe('Tab switching with number keys', () => {
    test('pressing 1 switches to overview tab', () => {
      renderHook(() => useAccountPanelHotkeys(getDefaultOptions()))
      document.dispatchEvent(createKeyboardEvent('1'))
      expect(mockOnTabChange).toHaveBeenCalledWith('overview')
    })

    test('pressing 2 switches to transactions tab', () => {
      renderHook(() => useAccountPanelHotkeys(getDefaultOptions()))
      document.dispatchEvent(createKeyboardEvent('2'))
      expect(mockOnTabChange).toHaveBeenCalledWith('transactions')
    })

    test('pressing 3 switches to fees tab', () => {
      renderHook(() => useAccountPanelHotkeys(getDefaultOptions()))
      document.dispatchEvent(createKeyboardEvent('3'))
      expect(mockOnTabChange).toHaveBeenCalledWith('fees')
    })

    test('pressing 4 switches to accruals tab', () => {
      renderHook(() => useAccountPanelHotkeys(getDefaultOptions()))
      document.dispatchEvent(createKeyboardEvent('4'))
      expect(mockOnTabChange).toHaveBeenCalledWith('accruals')
    })

    test('pressing 5 switches to ecl tab', () => {
      renderHook(() => useAccountPanelHotkeys(getDefaultOptions()))
      document.dispatchEvent(createKeyboardEvent('5'))
      expect(mockOnTabChange).toHaveBeenCalledWith('ecl')
    })

    test('pressing 6 switches to actions tab', () => {
      renderHook(() => useAccountPanelHotkeys(getDefaultOptions()))
      document.dispatchEvent(createKeyboardEvent('6'))
      expect(mockOnTabChange).toHaveBeenCalledWith('actions')
    })

    test('pressing 7 does not switch tabs (out of range)', () => {
      renderHook(() => useAccountPanelHotkeys(getDefaultOptions()))
      document.dispatchEvent(createKeyboardEvent('7'))
      expect(mockOnTabChange).not.toHaveBeenCalled()
    })

    test('pressing 0 does not switch tabs (out of range)', () => {
      renderHook(() => useAccountPanelHotkeys(getDefaultOptions()))
      document.dispatchEvent(createKeyboardEvent('0'))
      expect(mockOnTabChange).not.toHaveBeenCalled()
    })
  })

  describe('Account navigation with arrow keys', () => {
    test('pressing ArrowDown moves to next account', () => {
      renderHook(() =>
        useAccountPanelHotkeys({
          ...getDefaultOptions(),
          selectedAccountId: 'acc-1',
        })
      )
      document.dispatchEvent(createKeyboardEvent('ArrowDown'))
      expect(mockOnSwitchAccount).toHaveBeenCalledWith('acc-2')
    })

    test('pressing ArrowUp moves to previous account', () => {
      renderHook(() =>
        useAccountPanelHotkeys({
          ...getDefaultOptions(),
          selectedAccountId: 'acc-2',
        })
      )
      document.dispatchEvent(createKeyboardEvent('ArrowUp'))
      expect(mockOnSwitchAccount).toHaveBeenCalledWith('acc-1')
    })

    test('pressing ArrowDown on last account wraps to first', () => {
      renderHook(() =>
        useAccountPanelHotkeys({
          ...getDefaultOptions(),
          selectedAccountId: 'acc-3',
        })
      )
      document.dispatchEvent(createKeyboardEvent('ArrowDown'))
      expect(mockOnSwitchAccount).toHaveBeenCalledWith('acc-1')
    })

    test('pressing ArrowUp on first account wraps to last', () => {
      renderHook(() =>
        useAccountPanelHotkeys({
          ...getDefaultOptions(),
          selectedAccountId: 'acc-1',
        })
      )
      document.dispatchEvent(createKeyboardEvent('ArrowUp'))
      expect(mockOnSwitchAccount).toHaveBeenCalledWith('acc-3')
    })

    test('arrow keys do not switch when only one account', () => {
      renderHook(() =>
        useAccountPanelHotkeys({
          ...getDefaultOptions(),
          accountIds: ['acc-1'],
          selectedAccountId: 'acc-1',
        })
      )
      document.dispatchEvent(createKeyboardEvent('ArrowDown'))
      expect(mockOnSwitchAccount).not.toHaveBeenCalled()
    })
  })

  describe('Escape to close', () => {
    test('pressing Escape calls onClose', () => {
      renderHook(() => useAccountPanelHotkeys(getDefaultOptions()))
      document.dispatchEvent(createKeyboardEvent('Escape'))
      expect(mockOnClose).toHaveBeenCalled()
    })
  })

  describe('Modifier key handling', () => {
    test('ignores shortcuts when Cmd/Meta key is pressed', () => {
      renderHook(() => useAccountPanelHotkeys(getDefaultOptions()))
      document.dispatchEvent(createKeyboardEvent('1', { metaKey: true }))
      expect(mockOnTabChange).not.toHaveBeenCalled()
    })

    test('ignores shortcuts when Ctrl key is pressed', () => {
      renderHook(() => useAccountPanelHotkeys(getDefaultOptions()))
      document.dispatchEvent(createKeyboardEvent('1', { ctrlKey: true }))
      expect(mockOnTabChange).not.toHaveBeenCalled()
    })

    test('ignores shortcuts when Alt key is pressed', () => {
      renderHook(() => useAccountPanelHotkeys(getDefaultOptions()))
      document.dispatchEvent(createKeyboardEvent('1', { altKey: true }))
      expect(mockOnTabChange).not.toHaveBeenCalled()
    })
  })

  describe('isActive flag', () => {
    test('ignores all shortcuts when isActive is false', () => {
      renderHook(() =>
        useAccountPanelHotkeys({
          ...getDefaultOptions(),
          isActive: false,
        })
      )

      document.dispatchEvent(createKeyboardEvent('1'))
      document.dispatchEvent(createKeyboardEvent('ArrowDown'))
      document.dispatchEvent(createKeyboardEvent('Escape'))

      expect(mockOnTabChange).not.toHaveBeenCalled()
      expect(mockOnSwitchAccount).not.toHaveBeenCalled()
      expect(mockOnClose).not.toHaveBeenCalled()
    })
  })

  describe('Cleanup', () => {
    test('removes event listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')
      const { unmount } = renderHook(() => useAccountPanelHotkeys(getDefaultOptions()))

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    })
  })
})
