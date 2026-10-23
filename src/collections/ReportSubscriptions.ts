import type { Access, CollectionConfig } from 'payload'
import { hideFromNonAdmins, isAdmin } from '@/lib/access'
import {
  ALERT_OPERATORS,
  SUBSCRIPTION_CHANNELS,
  SUBSCRIPTION_FREQUENCIES,
} from '@/lib/reports/subscriptions'

/** People read their own subscriptions; admins read everyone's. */
const ownOrAdmin: Access = ({ req }) => {
  if (!req.user) return false
  if (isAdmin(req.user)) return true
  return { user: { equals: req.user.id } }
}

/**
 * Report subscriptions: a report sent to one person on a schedule (a
 * digest), or an alert when a number crosses a threshold. Written only
 * through `/api/reports/subscriptions` for the signed-in user, which checks
 * they can run the report; sent by the daily deliveries job
 * (`src/server/reporting/deliveries.ts`), which checks again each time.
 */
export const ReportSubscriptions: CollectionConfig = {
  slug: 'report-subscriptions',
  labels: { singular: 'Report subscription', plural: 'Report subscriptions' },
  admin: {
    group: 'Reporting',
    hidden: hideFromNonAdmins,
    defaultColumns: ['report', 'user', 'kind', 'frequency', 'paused', 'lastSentAt'],
  },
  access: {
    read: ownOrAdmin,
    create: () => false,
    update: () => false,
    delete: ({ req }) => isAdmin(req.user),
  },
  fields: [
    // Not required in the database: deleting a user or a report leaves the
    // subscription with no user or report (the foreign key sets NULL), and
    // the job skips it, rather than blocking the delete.
    { name: 'user', type: 'relationship', relationTo: 'users', index: true },
    { name: 'report', type: 'relationship', relationTo: 'report-definitions', index: true },
    {
      name: 'kind',
      type: 'select',
      required: true,
      options: [
        { label: 'Report on a schedule', value: 'digest' },
        { label: 'Alert', value: 'alert' },
      ],
    },
    {
      name: 'frequency',
      type: 'select',
      options: SUBSCRIPTION_FREQUENCIES.map((f) => ({ label: f, value: f })),
      admin: { description: 'Digests only. Alerts are checked every morning.' },
    },
    {
      name: 'range',
      type: 'text',
      admin: { description: 'The period preset each delivery covers, e.g. last-7.' },
    },
    { name: 'parameters', type: 'json', defaultValue: {} },
    {
      name: 'channel',
      type: 'select',
      required: true,
      defaultValue: 'email',
      options: SUBSCRIPTION_CHANNELS.map((c) => ({ label: c, value: c })),
    },
    {
      name: 'alert',
      type: 'group',
      admin: { condition: (data) => data?.kind === 'alert' },
      fields: [
        { name: 'column', type: 'text' },
        { name: 'row', type: 'text' },
        { name: 'value', type: 'text' },
        {
          name: 'operator',
          type: 'select',
          options: ALERT_OPERATORS.map((o) => ({ label: o, value: o })),
        },
        { name: 'threshold', type: 'number' },
        {
          name: 'active',
          type: 'checkbox',
          defaultValue: false,
          admin: { description: 'The condition held at the last check; alerts send on a change.' },
        },
        { name: 'lastValue', type: 'number' },
      ],
    },
    { name: 'paused', type: 'checkbox', defaultValue: false },
    { name: 'lastCheckedAt', type: 'date', admin: { readOnly: true } },
    { name: 'lastSentAt', type: 'date', admin: { readOnly: true } },
    { name: 'lastError', type: 'text', admin: { readOnly: true } },
  ],
}
