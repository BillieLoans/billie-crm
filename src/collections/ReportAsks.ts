import type { CollectionConfig } from 'payload'
import { hideFromNonAdmins, isAdmin } from '@/lib/access'

/**
 * Ask Claude requests (BTB-508): an append-only log of every question,
 * refinement and hand-edited check, with tokens, latency, model and prompt
 * versions, and the outcome of the deterministic checks. The R&D record for
 * the AI-authored reports experiment, and the cost record for the feature.
 *
 * Also logs each `run_report_query` over the MCP connector (BTB-509, kind
 * `mcp_query`): the SQL and its row count, never the rows.
 *
 * Written only by the Ask route and the connector with `overrideAccess`.
 * Questions are staff text about reports; no report rows are stored here or
 * sent to Claude by the Ask panel.
 */
export const ReportAsks: CollectionConfig = {
  slug: 'report-asks',
  labels: { singular: 'Ask Claude request', plural: 'Ask Claude requests' },
  admin: {
    useAsTitle: 'question',
    group: 'Reporting',
    defaultColumns: [
      'question',
      'kind',
      'outcome',
      'user',
      'outputTokens',
      'latencyMs',
      'createdAt',
    ],
    hidden: hideFromNonAdmins,
  },
  access: {
    read: ({ req }) => isAdmin(req.user),
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'user', type: 'relationship', relationTo: 'users', index: true },
    {
      name: 'kind',
      type: 'select',
      required: true,
      options: [
        { label: 'Question', value: 'ask' },
        { label: 'Refinement', value: 'refine' },
        { label: 'Edited SQL check', value: 'check' },
        { label: 'MCP query', value: 'mcp_query' },
      ],
    },
    { name: 'question', type: 'textarea' },
    { name: 'refinement', type: 'textarea' },
    {
      name: 'outcome',
      type: 'select',
      required: true,
      options: [
        { label: 'Draft passed checks', value: 'ok' },
        { label: 'Draft failed checks', value: 'invalid' },
        { label: 'Not answerable', value: 'unanswerable' },
        { label: 'Refused', value: 'refused' },
        { label: 'Unusable output', value: 'invalid_output' },
        { label: 'Failed', value: 'error' },
      ],
    },
    { name: 'model', type: 'text' },
    { name: 'effort', type: 'text' },
    { name: 'promptVersion', type: 'text' },
    { name: 'schemaVersion', type: 'text' },
    { name: 'inputTokens', type: 'number' },
    { name: 'outputTokens', type: 'number' },
    { name: 'cacheReadTokens', type: 'number' },
    { name: 'cacheWriteTokens', type: 'number' },
    { name: 'latencyMs', type: 'number' },
    { name: 'errorCount', type: 'number' },
    { name: 'warningCount', type: 'number' },
    { name: 'definition', type: 'json' },
  ],
}
