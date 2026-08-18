import { describe, it, expect, afterEach } from 'vitest'
import { describeElement, sanitizeUrl } from '@/lib/issue-diagnostics/sanitize'
import { NO_TRACK_ATTR, REDACTED_QUERY_PARAMS } from '@/lib/issue-diagnostics/constants'

/** Mount markup and return the element matching `selector`. */
function mount(html: string, selector: string): Element {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  const el = host.querySelector(selector)
  if (!el) throw new Error(`no element for selector ${selector}`)
  return el
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('sanitizeUrl', () => {
  it('returns "" for an empty url', () => {
    expect(sanitizeUrl('')).toBe('')
  })

  it('keeps the path and drops the origin', () => {
    expect(sanitizeUrl('https://crm.billie.loans/admin/servicing/LOAN-1')).toBe(
      '/admin/servicing/LOAN-1',
    )
  })

  it('drops the hash fragment', () => {
    expect(sanitizeUrl('https://crm.billie.loans/admin/dashboard#section-secret')).toBe(
      '/admin/dashboard',
    )
  })

  it('tolerates a relative url', () => {
    expect(sanitizeUrl('/admin/collections-queue?page=2')).toBe('/admin/collections-queue?page=2')
  })

  it('keeps non-sensitive query params untouched', () => {
    expect(sanitizeUrl('/admin/exports?page=3&status=open')).toBe(
      '/admin/exports?page=3&status=open',
    )
  })

  it.each(REDACTED_QUERY_PARAMS)('redacts the value of the "%s" param', (param) => {
    const result = sanitizeUrl(`/admin/x?${param}=super-sensitive-value`)

    expect(result).toBe(`/admin/x?${param}=%5Bredacted%5D`)
    expect(result).not.toContain('super-sensitive-value')
  })

  it('redacts every sensitive param present while keeping the safe ones', () => {
    const result = sanitizeUrl(
      '/admin/search?q=jane+doe&email=jane@example.com&token=abc123&page=2',
    )

    expect(result).not.toContain('jane')
    expect(result).not.toContain('abc123')
    expect(result).not.toContain('example.com')
    expect(result).toContain('page=2')
    expect(decodeURIComponent(result)).toContain('q=[redacted]')
    expect(decodeURIComponent(result)).toContain('email=[redacted]')
    expect(decodeURIComponent(result)).toContain('token=[redacted]')
  })

  it('does not invent params that were absent', () => {
    expect(sanitizeUrl('/admin/dashboard')).toBe('/admin/dashboard')
  })

  it('redacts a sensitive param that carries an empty value', () => {
    expect(decodeURIComponent(sanitizeUrl('/admin/x?token='))).toBe('/admin/x?token=[redacted]')
  })

  it('does not leak credentials embedded in the authority section', () => {
    const result = sanitizeUrl('https://user:hunter2@example.com/admin/x')

    expect(result).toBe('/admin/x')
    expect(result).not.toContain('hunter2')
  })
})

describe('describeElement', () => {
  describe('privacy', () => {
    it('returns null for a password input', () => {
      const el = mount('<input type="password" name="pw" value="hunter2" />', 'input')
      expect(describeElement(el)).toBeNull()
    })

    it('returns null for an element inside a [data-issue-no-track] subtree', () => {
      const el = mount(`<div ${NO_TRACK_ATTR}><button id="b">Pay</button></div>`, 'button')
      expect(describeElement(el)).toBeNull()
    })

    it('returns null for the opted-out element itself', () => {
      const el = mount(`<button ${NO_TRACK_ATTR} id="b">Pay</button>`, 'button')
      expect(describeElement(el)).toBeNull()
    })

    it('never includes a text input’s value', () => {
      const el = mount(
        '<input type="text" name="amount" id="amt" placeholder="Amount" />',
        'input',
      ) as HTMLInputElement
      el.value = '1234.56'

      const described = describeElement(el)

      expect(described).not.toBeNull()
      expect(JSON.stringify(described)).not.toContain('1234.56')
    })

    it('never uses a non-button element’s textContent as the label', () => {
      const el = mount('<div id="pii">Jane Doe — 0400 000 000</div>', 'div')

      expect(describeElement(el)).toEqual({ target: 'div#pii', label: null })
    })

    it('never uses an input’s surrounding text as a label', () => {
      const el = mount('<label>Customer email<input type="email" /></label>', 'input')

      expect(describeElement(el)?.label).toBeNull()
    })
  })

  describe('label resolution', () => {
    it('prefers the name attribute', () => {
      const el = mount(
        '<input name="the-name" aria-label="the-aria" placeholder="the-placeholder" />',
        'input',
      )
      expect(describeElement(el)?.label).toBe('the-name')
    })

    it('falls back to aria-label when name is absent', () => {
      const el = mount('<input aria-label="the-aria" placeholder="the-placeholder" />', 'input')
      expect(describeElement(el)?.label).toBe('the-aria')
    })

    it('falls back to placeholder when name and aria-label are absent', () => {
      const el = mount('<input placeholder="the-placeholder" />', 'input')
      expect(describeElement(el)?.label).toBe('the-placeholder')
    })

    it('uses trimmed textContent for a button', () => {
      const el = mount('<button>  Record repayment \n </button>', 'button')
      expect(describeElement(el)?.label).toBe('Record repayment')
    })

    it('uses textContent for a link', () => {
      const el = mount('<a href="/admin/x">Open account</a>', 'a')
      expect(describeElement(el)?.label).toBe('Open account')
    })

    it('uses textContent for role="button"', () => {
      const el = mount('<div role="button">Fake button</div>', 'div')
      expect(describeElement(el)?.label).toBe('Fake button')
    })

    it('returns a null label when nothing is available', () => {
      const el = mount('<span></span>', 'span')
      expect(describeElement(el)?.label).toBeNull()
    })

    it('returns a null label for an empty button', () => {
      const el = mount('<button>   </button>', 'button')
      expect(describeElement(el)?.label).toBeNull()
    })

    it('truncates the label to 60 characters', () => {
      const long = 'x'.repeat(200)
      const el = mount(`<button aria-label="${long}">go</button>`, 'button')

      const label = describeElement(el)?.label

      expect(label).toHaveLength(60)
      expect(label).toBe('x'.repeat(60))
    })
  })

  describe('target format', () => {
    it('formats as tag#id.classes', () => {
      const el = mount('<button id="submit" class="btn primary">Go</button>', 'button')
      expect(describeElement(el)?.target).toBe('button#submit.btn.primary')
    })

    it('lowercases the tag name', () => {
      const el = mount('<BUTTON id="b">Go</BUTTON>', 'button')
      expect(describeElement(el)?.target.startsWith('button')).toBe(true)
    })

    it('omits the id when absent', () => {
      const el = mount('<div class="only-class"></div>', 'div')
      expect(describeElement(el)?.target).toBe('div.only-class')
    })

    it('omits classes when absent', () => {
      const el = mount('<div id="only-id"></div>', 'div')
      expect(describeElement(el)?.target).toBe('div#only-id')
    })

    it('is just the tag when there is neither id nor class', () => {
      const el = mount('<section></section>', 'section')
      expect(describeElement(el)?.target).toBe('section')
    })

    it('keeps at most the first two classes', () => {
      const el = mount('<div class="a b c d e"></div>', 'div')
      expect(describeElement(el)?.target).toBe('div.a.b')
    })

    it('truncates the target to 120 characters', () => {
      const el = mount(`<div id="${'i'.repeat(300)}" class="${'c'.repeat(50)}"></div>`, 'div')

      const target = describeElement(el)?.target

      expect(target).toHaveLength(120)
    })
  })

  describe('resilience', () => {
    it('returns null for a non-element value', () => {
      expect(describeElement(null as unknown as Element)).toBeNull()
      expect(describeElement({} as unknown as Element)).toBeNull()
    })

    it('returns null rather than throwing when closest() throws', () => {
      const el = mount('<div id="x"></div>', 'div')
      const broken = {
        tagName: 'DIV',
        closest: () => {
          throw new Error('boom')
        },
      } as unknown as Element
      void el

      expect(describeElement(broken)).toBeNull()
    })
  })
})
