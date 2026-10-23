/**
 * One check, shared by every view's single-key shortcuts: is the person
 * typing into a field?
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  characterShortcutAllowed,
  isEditableTarget,
  setSingleKeyShortcutsEnabled,
  singleKeyShortcutsEnabled,
} from '@/lib/keyboard'

describe('isEditableTarget', () => {
  it('is true for fields and editable content, however editability is set', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(isEditableTarget(document.createElement(tag))).toBe(true)
    }
    for (const value of ['true', '', 'plaintext-only']) {
      const div = document.createElement('div')
      div.setAttribute('contenteditable', value)
      expect(isEditableTarget(div)).toBe(true)
    }
  })

  it('is false for buttons, links, plain elements, the window and nothing', () => {
    expect(isEditableTarget(document.createElement('button'))).toBe(false)
    expect(isEditableTarget(document.createElement('a'))).toBe(false)
    const off = document.createElement('div')
    off.setAttribute('contenteditable', 'false')
    expect(isEditableTarget(off)).toBe(false)
    expect(isEditableTarget(window)).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })
})

describe('single-key shortcuts switch (WCAG 2.1.4)', () => {
  afterEach(() => setSingleKeyShortcutsEnabled(true))
  const press = (
    key: string,
    mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {},
  ) => ({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    ...mods,
  })

  it('is on unless turned off, and off stops only one-character keys', () => {
    expect(singleKeyShortcutsEnabled()).toBe(true)
    expect(characterShortcutAllowed(press('j'))).toBe(true)
    setSingleKeyShortcutsEnabled(false)
    expect(singleKeyShortcutsEnabled()).toBe(false)
    for (const key of ['j', '/', '?', 'n', '3']) {
      expect(characterShortcutAllowed(press(key))).toBe(false)
    }
    for (const key of ['ArrowDown', 'Enter', 'Escape', ' ']) {
      expect(characterShortcutAllowed(press(key))).toBe(true)
    }
    // Modified keys are not single-key shortcuts; AltGr typing a character is.
    expect(characterShortcutAllowed(press('e', { metaKey: true }))).toBe(true)
    expect(
      characterShortcutAllowed({
        ...press('/', { ctrlKey: true, altKey: true }),
        getModifierState: (k: string) => k === 'AltGraph',
      }),
    ).toBe(false)
    setSingleKeyShortcutsEnabled(true)
    expect(characterShortcutAllowed(press('j'))).toBe(true)
  })
})
