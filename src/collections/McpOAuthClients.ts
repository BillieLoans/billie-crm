import type { CollectionConfig } from 'payload'
import { isAdmin } from '@/lib/access'

/**
 * OAuth clients of the reporting MCP connector: the apps (claude.ai, Claude
 * Code) that registered themselves through dynamic client registration
 * (`src/server/reporting/mcp-oauth.ts`).
 *
 * A registration grants nothing: a person still signs in to the CRM and
 * approves each connection, which is recorded in MCP connections. Written
 * only by the registration endpoint with `overrideAccess`. Hidden from the
 * sidebar; admins revoke connections, not clients.
 */
export const McpOAuthClients: CollectionConfig = {
  slug: 'mcp-oauth-clients',
  labels: { singular: 'MCP OAuth client', plural: 'MCP OAuth clients' },
  admin: {
    useAsTitle: 'clientName',
    group: 'Reporting',
    hidden: true,
  },
  access: {
    read: ({ req }) => isAdmin(req.user),
    create: () => false,
    update: () => false,
    delete: ({ req }) => isAdmin(req.user),
  },
  fields: [
    { name: 'clientId', type: 'text', required: true, unique: true, index: true },
    {
      name: 'clientName',
      type: 'text',
      admin: { description: 'Chosen by the client when it registered; not verified' },
    },
    { name: 'redirectUris', type: 'json', required: true },
    {
      name: 'tokenEndpointAuthMethod',
      type: 'select',
      required: true,
      defaultValue: 'none',
      options: [
        { label: 'None (public client, PKCE only)', value: 'none' },
        { label: 'Client secret (post)', value: 'client_secret_post' },
        { label: 'Client secret (basic)', value: 'client_secret_basic' },
      ],
    },
    {
      name: 'secretIndex',
      type: 'text',
      hidden: true,
      admin: { description: 'HMAC of the client secret, for confidential clients' },
    },
  ],
}
