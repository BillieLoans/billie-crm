import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { renderNoteContent } from '@/lib/tiptap'

const docWithLink = (href: string) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Click here',
          marks: [{ type: 'link', attrs: { href } }],
        },
      ],
    },
  ],
})

describe('Tiptap link protocol validation', () => {
  it('renders <a> tag for valid http:// URLs', () => {
    const { rich } = renderNoteContent(docWithLink('http://example.com'))
    const { container } = render(<>{rich}</>)
    const anchor = container.querySelector('a')
    expect(anchor).not.toBeNull()
    expect(anchor?.getAttribute('href')).toBe('http://example.com')
    expect(anchor?.textContent).toBe('Click here')
  })

  it('renders <a> tag for valid https:// URLs', () => {
    const { rich } = renderNoteContent(docWithLink('https://example.com'))
    const { container } = render(<>{rich}</>)
    const anchor = container.querySelector('a')
    expect(anchor).not.toBeNull()
    expect(anchor?.getAttribute('href')).toBe('https://example.com')
  })

  it('does NOT render <a> tag for javascript: URIs', () => {
    const { rich } = renderNoteContent(docWithLink('javascript:alert(1)'))
    const { container } = render(<>{rich}</>)
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toBe('Click here')
  })

  it('does NOT render <a> tag for data: URIs', () => {
    const { rich } = renderNoteContent(docWithLink('data:text/html,<script>alert(1)</script>'))
    const { container } = render(<>{rich}</>)
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toBe('Click here')
  })

  it('does NOT render <a> tag for vbscript: URIs', () => {
    const { rich } = renderNoteContent(docWithLink('vbscript:MsgBox("xss")'))
    const { container } = render(<>{rich}</>)
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toBe('Click here')
  })

  it('does NOT render <a> tag for empty href', () => {
    const { rich } = renderNoteContent(docWithLink(''))
    const { container } = render(<>{rich}</>)
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toBe('Click here')
  })

  it('handles links with mixed case protocols', () => {
    const { rich } = renderNoteContent(docWithLink('HTTPS://example.com'))
    const { container } = render(<>{rich}</>)
    const anchor = container.querySelector('a')
    expect(anchor).not.toBeNull()
    expect(anchor?.getAttribute('href')).toBe('HTTPS://example.com')
  })

  it('sets target="_blank" and rel="noopener noreferrer" on safe links', () => {
    const { rich } = renderNoteContent(docWithLink('https://example.com'))
    const { container } = render(<>{rich}</>)
    const anchor = container.querySelector('a')
    expect(anchor?.getAttribute('target')).toBe('_blank')
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer')
  })
})
