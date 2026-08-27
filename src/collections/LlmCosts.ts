import type { CollectionConfig, Access } from 'payload'
import { hideFromNonAdmins, hasApprovalAuthority } from '@/lib/access'

const supervisorOrAdmin: Access = ({ req: { user } }) => {
  return hasApprovalAuthority(user)
}

/**
 * LLM cost per call — projection of billieChat's `llm_logs` Redis stream
 * (BTB-302), written by the event-processor's `handle_llm_log`.
 *
 * Projection, not a copy: numeric fields and ids only. No prompt or
 * response text is ever stored here. Cost is stored BOTH as logged and as
 * recomputed from tokens × the versioned rate table (`rateVersion`), so
 * history never silently restates when rates change.
 */
export const LlmCosts: CollectionConfig = {
  slug: 'llm-costs',
  admin: {
    useAsTitle: 'streamId',
    defaultColumns: [
      'calledAt',
      'conversationId',
      'agentName',
      'model',
      'computedCostUsd',
      'priced',
    ],
    group: 'Supervisor Dashboard',
    hidden: hideFromNonAdmins,
    description:
      'LLM cost per call (llm_logs projection). Filter by conversation, agent, model or day; join to a loan via the conversation record. No customer text lives here.',
  },
  access: {
    read: supervisorOrAdmin,
    create: () => false, // Only created via events
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'streamId',
      type: 'text',
      required: true,
      unique: true,
      admin: { readOnly: true, description: 'llm_logs stream entry id (dedup key)' },
    },
    {
      name: 'conversationId',
      type: 'text',
      index: true,
      admin: {
        readOnly: true,
        description:
          'Join key to conversations.conversationId (→ application, customer, loan)',
      },
    },
    { name: 'seq', type: 'number', admin: { readOnly: true } },
    { name: 'model', type: 'text', index: true, admin: { readOnly: true } },
    { name: 'agentName', type: 'text', index: true, admin: { readOnly: true } },
    { name: 'serviceTier', type: 'text', admin: { readOnly: true } },
    { name: 'promptTokens', type: 'number', admin: { readOnly: true } },
    { name: 'completionTokens', type: 'number', admin: { readOnly: true } },
    { name: 'cachedTokens', type: 'number', admin: { readOnly: true } },
    { name: 'reasoningTokens', type: 'number', admin: { readOnly: true } },
    { name: 'totalTokens', type: 'number', admin: { readOnly: true } },
    { name: 'responseTimeMs', type: 'number', admin: { readOnly: true } },
    {
      name: 'loggedCostUsd',
      type: 'number',
      admin: { readOnly: true, description: 'Cost as logged by LiteLLM at call time' },
    },
    {
      name: 'computedCostUsd',
      type: 'number',
      admin: {
        readOnly: true,
        description: 'Recomputed from tokens × the versioned rate table',
      },
    },
    {
      name: 'rateVersion',
      type: 'text',
      admin: { readOnly: true, description: 'Rate table version in force at ingest' },
    },
    {
      name: 'hasUsage',
      type: 'checkbox',
      admin: {
        readOnly: true,
        description:
          'False = the source llm_logs row carried a cost but no token counts (upstream telemetry gap) — computed cost is not derivable; use loggedCostUsd',
      },
    },
    {
      name: 'priced',
      type: 'checkbox',
      admin: {
        readOnly: true,
        description:
          'False = model missing from the rate table (never silently costed at zero) — update llm_rates.py',
      },
    },
    { name: 'calledAt', type: 'date', index: true, admin: { readOnly: true } },
  ],
  timestamps: true,
}
