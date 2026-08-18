import { NO_TRACK_ATTR, REDACTED_QUERY_PARAMS } from './constants'

/** Elements whose visible text is safe to use as a label (never inputs) */
const TEXT_LABEL_SELECTOR = 'button, a, [role="button"]'

/**
 * Redact sensitive query-param VALUES while keeping the path.
 *
 * Relative URLs are tolerated via a throwaway base; the returned string is
 * always path + query (never the origin, never a hash), so nothing
 * identifying leaks through a URL fragment.
 */
export function sanitizeUrl(url: string): string {
  if (!url) return ''

  try {
    const parsed = new URL(url, 'http://x')

    for (const param of REDACTED_QUERY_PARAMS) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, '[redacted]')
      }
    }

    const query = parsed.searchParams.toString()
    return query ? `${parsed.pathname}?${query}` : parsed.pathname
  } catch {
    // Unparseable — drop it rather than risk leaking a raw string
    return ''
  }
}

/**
 * Describe an element by IDENTITY only.
 *
 * PRIVACY: never reads `.value`. Labels come from the name/aria-label/
 * placeholder attributes, or — for buttons and links only — the trimmed
 * visible text. Password inputs and anything inside a `[data-issue-no-track]`
 * subtree return null so the caller skips the event entirely.
 */
export function describeElement(el: Element): { target: string; label: string | null } | null {
  try {
    if (!el || typeof el.tagName !== 'string') return null

    // Opt-out subtree
    if (el.closest?.(`[${NO_TRACK_ATTR}]`)) return null

    // Never describe a password field
    if (el.matches?.('input[type="password"]')) return null

    const tag = el.tagName.toLowerCase()
    const id = el.id ? `#${el.id}` : ''
    const classes = Array.from(el.classList ?? [])
      .slice(0, 2)
      .map((c) => `.${c}`)
      .join('')

    const target = `${tag}${id}${classes}`.slice(0, 120)

    const label =
      el.getAttribute('name') ||
      el.getAttribute('aria-label') ||
      el.getAttribute('placeholder') ||
      (el.matches?.(TEXT_LABEL_SELECTOR) ? (el.textContent ?? '').trim() : '')

    return { target, label: label ? label.slice(0, 60) : null }
  } catch {
    return null
  }
}
