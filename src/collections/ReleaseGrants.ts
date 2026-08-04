import type { CollectionConfig, Access } from 'payload'
import { canReadMarketing, hideFromNonAdmins } from '@/lib/access'

const marketingRead: Access = ({ req: { user } }) => canReadMarketing(user)

export const ReleaseGrants: CollectionConfig = {
  slug: 'release-grants',
  admin: {
    useAsTitle: 'mobileE164',
    defaultColumns: ['releaseId', 'mobileE164', 'status', 'claimedAt'],
    group: 'Marketing',
    hidden: hideFromNonAdmins,
    description:
      'Per-person release grants — read-only projection, natural key (releaseId, mobileE164)',
  },
  access: {
    read: marketingRead,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'releaseId', type: 'text', required: true, index: true, admin: { readOnly: true } },
    { name: 'mobileE164', type: 'text', required: true, admin: { readOnly: true } },
    { name: 'contactId', type: 'text', index: true, admin: { readOnly: true } },
    {
      name: 'customerId',
      type: 'text',
      index: true,
      admin: {
        readOnly: true,
        description:
          'Back-filled by the event processor when a customer.* event lands with a mobile matching this grant (join key: verified mobile).',
      },
    },
    {
      name: 'source',
      type: 'select',
      options: ['targeted', 'quota_claim'],
      admin: { readOnly: true },
    },
    {
      name: 'status',
      type: 'select',
      options: ['granted', 'claimed', 'expired', 'revoked'],
      admin: { readOnly: true },
    },
    {
      name: 'smsStatus',
      type: 'select',
      options: ['sent', 'failed', 'not_sent'],
      admin: { readOnly: true },
    },
    { name: 'claimedAt', type: 'date', admin: { readOnly: true } },
  ],
  timestamps: true,
}
