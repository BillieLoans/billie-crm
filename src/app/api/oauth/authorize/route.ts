/**
 * /api/oauth/authorize — the authorization endpoint of the reporting MCP
 * connector's OAuth server. See `src/server/reporting/mcp-oauth.ts`.
 *
 * GET: a Claude app sends the person here. The request is checked, signed,
 * and handed to the sign-in page (`/oauth/authorize?req=…`) by a same-origin
 * page that navigates in the browser, not by a redirect: the person arrives
 * on a cross-site navigation, on which Payload ignores the session cookie,
 * so the sign-in page must be reached from this origin to see who is signed
 * in. (The Google login callback does the same, for the same reason.)
 *
 * POST: the decision on the sign-in page, approve or decline. A same-origin
 * form post, so the CSRF origin check in `src/proxy.ts` applies. It acts on
 * the request the page signed (`sealAuthorizationRequest`), never on the
 * form's own fields.
 */
import { NextResponse } from 'next/server'
import { getPayload } from 'payload'
import configPromise from '@payload-config'
import {
  appOrigin,
  approveAuthorization,
  checkAuthorizationRequest,
  denyAuthorization,
  openAuthorizationRequest,
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

export async function GET(request: Request) {
  const payload = await getPayload({ config: configPromise })
  const params = new URL(request.url).searchParams
  const check = await checkAuthorizationRequest(payload, params)
  const page = `${appOrigin()}/oauth/authorize`
  if (!check.ok) {
    if (check.redirectTo) return NextResponse.redirect(check.redirectTo, { status: 302 })
    return see(`${page}?problem=client`)
  }
  return continueTo(`${page}?req=${sealAuthorizationRequest(payload.secret, check.request)}`)
}

export async function POST(request: Request) {
  const form = await request.formData()
  const sealed = form.get('request')
  const payload = await getPayload({ config: configPromise })
  const authorization = openAuthorizationRequest(payload.secret, sealed)
  const page = `${appOrigin()}/oauth/authorize`
  if (!authorization) return see(`${page}?problem=expired`)
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) {
    const back = `/oauth/authorize?req=${encodeURIComponent(String(sealed))}`
    return see(`${appOrigin()}/admin/login?redirect=${encodeURIComponent(back)}`)
  }
  if (form.get('decision') !== 'allow') return see(denyAuthorization(authorization))
  const target = await approveAuthorization(payload, user, authorization)
  return see(target ?? `${page}?problem=expired`)
}
