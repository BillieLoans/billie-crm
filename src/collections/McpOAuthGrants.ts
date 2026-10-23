import type { CollectionConfig } from 'payload'
import { hideFromNonAdmins, isAdmin } from '@/lib/access'

/**
 * MCP connections: one per time a person approved a Claude app on the
 * CRM's sign-in page for the reporting connector
 * (`src/server/reporting/mcp-oauth.ts`).
 *
 * A connection holds the authorization code while it is being exchanged,
 * then the current access and refresh tokens. Codes and tokens are stored as
 * HMACs, never as themselves. Deleting a connection revokes it at once: its
 * tokens stop working on the next request. A person's connections are
 * deleted with them, and when they lose every staff role.
 *
 * Written only by the OAuth endpoints with `overrideAccess`. Admins read and
 * delete.
 */
export const McpOAuthGrants: CollectionConfig = {
  slug: 'mcp-oauth-grants',
  labels: { singular: 'MCP connection', plural: 'MCP connections' },
  admin: {
    useAsTitle: 'clientName',
    group: 'Reporting',
    description:
      'Claude apps people have connected to the reporting connector by signing in. Delete one to revoke it.',
    defaultColumns: ['user', 'clientName', 'redirectHost', 'lastUsedAt', 'createdAt'],
    hidden: hideFromNonAdmins,
  },
  access: {
    read: ({ req }) => isAdmin(req.user),
    create: () => false,
    update: () => false,
    delete: ({ req }) => isAdmin(req.user),
  },
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', required: true, index: true },
    { name: 'clientId', type: 'text', required: true, index: true },
    { name: 'clientName', type: 'text' },
    { name: 'redirectUri', type: 'text', required: true },
    {
      name: 'redirectHost',
      type: 'text',
      admin: { description: 'Where the person was sent back to after approving' },
    },
    { name: 'scope', type: 'text' },
    { name: 'resource', type: 'text', required: true },
    { name: 'codeIndex', type: 'text', unique: true, hidden: true },
    { name: 'codeChallenge', type: 'text', hidden: true },
    { name: 'codeExpiresAt', type: 'date', hidden: true },
    { name: 'codeUsed', type: 'checkbox', defaultValue: false, hidden: true },
    { name: 'accessIndex', type: 'text', unique: true, hidden: true },
    { name: 'accessExpiresAt', type: 'date', admin: { readOnly: true } },
    // The access token a refresh replaced stays valid until it expires.
    { name: 'previousAccessIndex', type: 'text', index: true, hidden: true },
    { name: 'previousAccessExpiresAt', type: 'date', hidden: true },
    { name: 'refreshIndex', type: 'text', unique: true, hidden: true },
    { name: 'previousRefreshIndex', type: 'text', index: true, hidden: true },
    { name: 'refreshExpiresAt', type: 'date', admin: { readOnly: true } },
    { name: 'refreshedAt', type: 'date', hidden: true },
    { name: 'lastUsedAt', type: 'date', admin: { readOnly: true } },
  ],
}
