/**
 * MCP API keys (BTB-509): lookup, and revocation when their person changes.
 * Kept apart from `mcp.ts` (the plugin config) so the users collection can
 * use the hooks without importing the plugin.
 */
import { createHmac } from 'node:crypto'
import type { CollectionAfterChangeHook, CollectionBeforeDeleteHook } from 'payload'
import { REPORT_AUTHOR_ROLES } from '@/lib/schemas/reports'

export const MCP_API_KEYS_SLUG = 'payload-mcp-api-keys' as const

/** The HMAC a key is found by. */
export function apiKeyIndex(secret: string, key: string): string {
  return createHmac('sha256', secret).update(key).digest('hex')
}

/**
 * A person who stops being a report author loses their keys for good:
 * promoting them again later does not bring an old key back.
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
  return doc
}

/** A deleted person's keys go with them (the key's user is required). */
export const deleteMcpKeysOfUser: CollectionBeforeDeleteHook = async ({ id, req }) => {
  await req.payload.delete({
    collection: MCP_API_KEYS_SLUG,
    where: { user: { equals: id } },
    overrideAccess: true,
    req,
  })
}
