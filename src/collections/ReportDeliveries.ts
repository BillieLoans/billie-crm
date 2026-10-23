import type { CollectionConfig } from 'payload'
import { hideFromNonAdmins, isAdmin } from '@/lib/access'

/**
 * One row per subscription delivery owed (a day, a Monday, a month), so the
 * deliveries job sends each at most once however often it is called: a
 * delivery first claims its key (unique), and a failed one releases the
 * claim so a later call retries. Written only by the job.
 */
export const ReportDeliveries: CollectionConfig = {
  slug: 'report-deliveries',
  labels: { singular: 'Report delivery', plural: 'Report deliveries' },
  admin: {
    group: 'Reporting',
    hidden: hideFromNonAdmins,
    defaultColumns: ['claimKey', 'status', 'detail', 'createdAt'],
  },
  access: {
    read: ({ req }) => isAdmin(req.user),
    create: () => false,
    update: () => false,
    delete: ({ req }) => isAdmin(req.user),
  },
  fields: [
    { name: 'subscription', type: 'relationship', relationTo: 'report-subscriptions', index: true },
    {
      name: 'claimKey',
      type: 'text',
      required: true,
      unique: true,
      admin: { description: '<subscription id>:<day, month or alert:day>' },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      options: [
        { label: 'Sending', value: 'sending' },
        { label: 'Sent', value: 'sent' },
        { label: 'Checked, nothing to send', value: 'checked' },
        { label: 'Skipped', value: 'skipped' },
      ],
    },
    { name: 'detail', type: 'text' },
  ],
}
