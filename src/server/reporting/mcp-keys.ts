/**
 * MCP API keys (BTB-509) and OAuth connections: lookup, and revocation when
 * their person changes. Kept apart from `mcp.ts` (the plugin config) so the
 * users collection can use the hooks without importing the plugin.
 */
import { createHmac } from 'node:crypto'
import type { CollectionAfterChangeHook, CollectionBeforeDeleteHook } from 'payload'
import { hasAnyRole } from '@/lib/access'
import { REPORT_AUTHOR_ROLES } from '@/lib/schemas/reports'

export const MCP_API_KEYS_SLUG = 'payload-mcp-api-keys' as const
export const OAUTH_GRANTS_SLUG = 'mcp-oauth-grants' as const

/** The HMAC a key is found by. */
export function apiKeyIndex(secret: string, key: string): string {
  return createHmac('sha256', secret).update(key).digest('hex')
}

/**
 * A person who stops being a report author loses their keys for good:
 * promoting them again later does not bring an old key back. One who loses
 * every staff role also loses their OAuth connections. (A connection's tools
 * follow the person's role on every request, so other role changes need
 * nothing here.)
 */
export const revokeMcpKeysOnRoleChange: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  if (operation !== 'update') return doc
  const was = REPORT_AUTHOR_ROLES.includes(previousDoc?.role)
  const is = REPORT_AUTHOR_ROLES.includes(doc?.role)
  if (was && !is) {
    await req.payload.delete({
      collection: MCP_API_KEYS_SLUG,
      where: { user: { equals: doc.id } },
      overrideAccess: true,
      req,
    })
  }
  if (hasAnyRole(previousDoc) && !hasAnyRole(doc)) {
    await req.payload.delete({
      collection: OAUTH_GRANTS_SLUG,
      where: { user: { equals: doc.id } },
      overrideAccess: true,
      req,
    })
  }
  return doc
}

/** A deleted person's keys and connections go with them (their user is required). */
export const deleteMcpKeysOfUser: CollectionBeforeDeleteHook = async ({ id, req }) => {
  for (const collection of [MCP_API_KEYS_SLUG, OAUTH_GRANTS_SLUG]) {
    await req.payload.delete({
      collection,
      where: { user: { equals: id } },
      overrideAccess: true,
      req,
    })
  }
}
