/**
 * Keyboard shortcut helpers shared by the CRM's views.
 */

/**
 * True when a key press is typing into a field: an input, a text area, a
 * select, or anything content-editable (including inherited editability
 * and `contenteditable=""`). Single-key shortcuts must not fire there.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as HTMLElement).tagName !== 'string') return false
  const el = target as HTMLElement
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable ||
    // jsdom does not compute isContentEditable from the attribute.
    (el.getAttribute?.('contenteditable') ?? 'false') !== 'false'
  )
}

/** localStorage key for turning single-character shortcuts off (a per-browser preference). */
export const SINGLE_KEY_SHORTCUTS_STORAGE_KEY = 'billie-single-key-shortcuts'

/**
 * Whether one-character shortcuts (j, k, /, ?, n, 1–6 …) are on. WCAG 2.1.4
 * requires a way to turn them off, since speech-input and some keyboard
 * users trigger them by accident; they are on unless the person turned them
 * off from the keyboard shortcuts list.
 */
export function singleKeyShortcutsEnabled(): boolean {
  try {
    return window.localStorage.getItem(SINGLE_KEY_SHORTCUTS_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setSingleKeyShortcutsEnabled(on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(SINGLE_KEY_SHORTCUTS_STORAGE_KEY)
    else window.localStorage.setItem(SINGLE_KEY_SHORTCUTS_STORAGE_KEY, 'off')
  } catch {
    // A preference only; without storage the shortcuts stay on.
  }
}

/**
 * False when the press is a one-character shortcut (a letter, digit or
 * punctuation key with no Ctrl, Cmd or Alt) and the person turned those off.
 * Arrows, Enter, Space, Escape and modified keys are not affected.
 */
export function characterShortcutAllowed(e: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  getModifierState?(key: 'AltGraph'): boolean
}): boolean {
  // AltGr (reported as Ctrl+Alt on Windows) types characters on some layouts.
  const altGr = e.getModifierState?.('AltGraph') ?? false
  const character = e.key.trim().length === 1 && !e.metaKey && (altGr || (!e.ctrlKey && !e.altKey))
  return !character || singleKeyShortcutsEnabled()
}
