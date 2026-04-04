'use client'

import React, { useMemo } from 'react'

/**
 * SanitizedHTML — the single source of truth for DOMPurify usage.
 * The ONLY component in the codebase that uses dangerouslySetInnerHTML.
 *
 * Sanitises HTML with DOMPurify using a strict allowlist:
 * b, i, em, strong, a, p, br, ul, ol, li, span
 *
 * XSS prevention: script, object, iframe, onXxx attributes are stripped.
 *
 * Story 3.2: Chat Transcript & HTML Sanitisation (FR30, FR31, NFR7)
 */

const ALLOWED_TAGS = ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'span']
const ALLOWED_ATTR = ['href', 'class', 'target', 'rel']

interface SanitizedHTMLProps {
  html: string
  className?: string
}

export function SanitizedHTML({ html, className }: SanitizedHTMLProps) {
  const sanitized = useMemo(() => {
    if (typeof window === 'undefined') {
      // SSR: strip all tags server-side (no DOMPurify on server)
      return html.replace(/<[^>]*>/g, '')
    }

    // Dynamic import ensures DOMPurify only loads in browser
    // This is loaded eagerly in the module scope on first client render
    const DOMPurify = require('dompurify') // eslint-disable-line @typescript-eslint/no-require-imports
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ADD_ATTR: ['target'],
    })
  }, [html])

  // dangerouslySetInnerHTML is intentional here — sanitized content only (NFR7)
  return <span className={className} dangerouslySetInnerHTML={{ __html: sanitized }} />
}
