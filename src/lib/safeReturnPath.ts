/**
 * A same-origin path (with its query) to send someone to after they sign in,
 * or null when `value` could lead anywhere else: an absolute or
 * protocol-relative URL, a backslash trick, or anything that resolves to
 * another origin. Used to carry the OAuth sign-in page through the Google
 * login (`/api/auth/google`).
 */
export function safeReturnPath(value: unknown, appUrl: string): string | null {
  if (typeof value !== 'string' || value.length > 4000) return null
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  try {
    const base = new URL(appUrl)
    const url = new URL(value, base)
    const path = `${url.pathname}${url.search}`
    // Dot segments can normalise to a protocol-relative path ('/.//x' -> '//x').
    return url.origin === base.origin && !path.startsWith('//') ? path : null
  } catch {
    return null
  }
}
