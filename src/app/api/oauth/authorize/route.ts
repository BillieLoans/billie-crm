/**
 * /api/oauth/authorize — the authorization endpoint of the reporting MCP
 * connector's OAuth server. See `src/server/reporting/mcp-oauth.ts`.
 *
 * GET: a Claude app sends the person here. The request is checked, bound to
 * this browser with a nonce cookie (`AUTHZ_COOKIE`), signed, and handed to
 * the sign-in page (`/oauth/authorize?req=…`) by a same-origin page that
 * navigates in the browser, not by a redirect: the person arrives on a
 * cross-site navigation, on which Payload ignores the session cookie, so
 * the sign-in page must be reached from this origin to see who is signed
 * in. (The Google login callback does the same, for the same reason.)
 *
 * POST: the decision on the sign-in page, approve or decline. A same-origin
 * form post, so the CSRF origin check in `src/proxy.ts` applies. It acts on
 * the request the page signed (`sealAuthorizationRequest`), never on the
 * form's own fields, and only when the browser holds the cookie the request
 * was bound to: a sign-in link passed to someone else does nothing in their
 * browser. Each request is approved at most once.
 */
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { rateLimit } from '@/lib/utils/rateLimit'
import {
  AUTHORIZE_REQUEST_TTL_MS,
  AUTHZ_COOKIE,
  appOrigin,
  approveAuthorization,
  bindAuthorizationRequest,
  checkAuthorizationRequest,
  denyAuthorization,
  newBrowserNonce,
  openAuthorizationRequest,
  requestMatchesBrowser,
  sealAuthorizationRequest,
} from '@/server/reporting/mcp-oauth'

const see = (url: string) => NextResponse.redirect(url, { status: 303 })

const attribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

/** A page that sends the browser on to `url`, as a navigation from this origin. */
function continueTo(url: string): NextResponse {
  const html = `<!DOCTYPE html><html lang="en-AU"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${attribute(url)}"><title>Connecting…</title></head><body style="font-family:system-ui,sans-serif;padding:2rem"><p>Connecting… <a href="${attribute(url)}">Continue</a></p><script>window.location.replace(${JSON.stringify(url)})</script></body></html>`
  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: appOrigin().startsWith('https:'),
  path: '/',
})

/** The nonce cookie, if the browser sent one. */
export function browserNonce(request: Request): string | undefined {
  const cookies = request.headers.get('cookie') ?? ''
  for (const part of cookies.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === AUTHZ_COOKIE) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

const clientIp = (request: Request) =>
  request.headers.get('cf-connecting-ip') ?? request.headers.get('fly-client-ip') ?? 'unknown'

export async function GET(request: Request) {
  if (!(await rateLimit(`oauth-authorize:${clientIp(request)}`, { limit: 60, windowMs: 60_000 }))) {
    return new NextResponse('Too many sign-in requests. Try again in a minute.', {
      status: 429,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  const payload = await getPayload({ config: configPromise })
  const params = new URL(request.url).searchParams
  const check = await checkAuthorizationRequest(payload, params)
  const page = `${appOrigin()}/oauth/authorize`
  if (!check.ok) {
    if (check.redirectTo) return NextResponse.redirect(check.redirectTo, { status: 302 })
    return see(`${page}?problem=client`)
  }
  const nonce = newBrowserNonce()
  const bound = bindAuthorizationRequest(check.request, nonce)
  const response = continueTo(`${page}?req=${sealAuthorizationRequest(payload.secret, bound)}`)
  response.cookies.set(AUTHZ_COOKIE, nonce, {
    ...cookieOptions(),
    maxAge: Math.floor(AUTHORIZE_REQUEST_TTL_MS / 1000),
  })
  return response
}

export async function POST(request: Request) {
  const form = await request.formData()
  const sealed = form.get('request')
  const payload = await getPayload({ config: configPromise })
  const authorization = openAuthorizationRequest(payload.secret, sealed)
  const page = `${appOrigin()}/oauth/authorize`
  if (!authorization) return see(`${page}?problem=expired`)
  if (!requestMatchesBrowser(authorization, browserNonce(request))) {
    return see(`${page}?problem=browser`)
  }
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) {
    const back = `/oauth/authorize?req=${encodeURIComponent(String(sealed))}`
    return see(`${appOrigin()}/admin/login?redirect=${encodeURIComponent(back)}`)
  }
  const target =
    form.get('decision') === 'allow'
      ? await approveAuthorization(payload, user, authorization)
      : denyAuthorization(authorization)
  // Back to the app by a page, not a redirect: the sign-in page's CSP has
  // `form-action 'self'`, which browsers also apply to where the post
  // redirects, so a 303 to Claude's callback (another origin) is blocked.
  const response = target ? continueTo(target) : see(`${page}?problem=expired`)
  // The decision is made: the request cannot be used again from this browser either.
  response.cookies.set(AUTHZ_COOKIE, '', { ...cookieOptions(), maxAge: 0 })
  return response
}
