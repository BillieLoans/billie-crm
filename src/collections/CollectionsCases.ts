import type { CollectionConfig, Access } from 'payload'
import { hideFromNonAdmins, hasAnyRole } from '@/lib/access'

const anyRole: Access = ({ req: { user } }) => hasAnyRole(user)

/**
 * Collection Cases — read-only projection (Stream D / BTB-199).
 *
 * Written by the Python event processor from the six `collection.case.*` events
 * the headless collectionsService (BTB-166) emits to ChatLedger:
 *   collection.case.opened.v1              → state = 'open'
 *   collection.case.exhausted.v1           → state = 'awaiting_human'
 *   collection.case.cured.v1               → state = 'cured'
 *   collection.case.hardship_paused.v1     → hardshipPaused = true   (flag; state unchanged)
 *   collection.case.resumed.v1             → hardshipPaused = false
 *   collection.case.stop_contact_applied.v1→ stoppedContact = true   (flag; state unchanged)
 *
 * One document per advance, keyed by `accountId` (unique). Operational state +
 * flags only — economics (cost-of-recovery gate, expected net recovery) come
 * from the collectionsService gRPC at read time (BTB-198), and live accounting
 * from the AccountingLedgerService gRPC. The projection is replay-rebuildable.
 */
export const CollectionsCases: CollectionConfig = {
  slug: 'collection-cases',
  admin: {
    useAsTitle: 'accountId',
    defaultColumns: ['accountId', 'customerId', 'state', 'overdueAmount', 'daysOverdue', 'updatedAt'],
    group: 'Supervisor Dashboard',
    hidden: hideFromNonAdmins,
  },
  access: {
    read: anyRole,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'accountId',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: { readOnly: true, description: 'Ledger account_id — one case per advance (natural key)' },
    },
    {
      name: 'customerRef',
      type: 'relationship',
      relationTo: 'customers',
      admin: {
        readOnly: true,
        description: 'Resolved customer link (may be null if customer not yet projected)',
      },
    },
    {
      name: 'customerId',
      type: 'text',
      index: true,
      admin: { readOnly: true, description: 'Customer ID string from the event (BTB-154 provenance)' },
    },
    {
      name: 'state',
      type: 'select',
      index: true,
      options: [
        { label: 'Open (overdue series active)', value: 'open' },
        { label: 'Awaiting human (exhausted)', value: 'awaiting_human' },
        { label: 'Cured', value: 'cured' },
      ],
      admin: { readOnly: true, description: 'Base lifecycle state. Cross-cutting hardship / stop-contact are flags.' },
    },
    {
      name: 'hardshipPaused',
      type: 'checkbox',
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'stoppedContact',
      type: 'checkbox',
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'overdueAmount',
      type: 'number',
      admin: { readOnly: true, step: 0.01, description: 'Snapshot from the event; live amount comes from the ledger' },
    },
    {
      name: 'daysOverdue',
      type: 'number',
      admin: { readOnly: true },
    },
    {
      name: 'lastStep',
      type: 'number',
      admin: { readOnly: true, description: 'Last automated reminder step sent (max 5); set on exhaustion' },
    },
    {
      name: 'dueDate',
      type: 'date',
      admin: { readOnly: true },
    },
    {
      name: 'openedAt',
      type: 'date',
      index: true,
      admin: { readOnly: true },
    },
    { name: 'curedAt', type: 'date', admin: { readOnly: true } },
    { name: 'exhaustedAt', type: 'date', admin: { readOnly: true } },
    { name: 'pausedAt', type: 'date', admin: { readOnly: true } },
    { name: 'resumedAt', type: 'date', admin: { readOnly: true } },
    { name: 'stopContactAt', type: 'date', admin: { readOnly: true } },
    {
      name: 'correlationId',
      type: 'text',
      admin: { readOnly: true },
    },
    { name: 'createdAt', type: 'date', admin: { readOnly: true } },
    { name: 'updatedAt', type: 'date', admin: { readOnly: true } },
  ],
}
