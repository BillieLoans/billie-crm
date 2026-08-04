import type { CollectionConfig, Access } from 'payload'
import { canReadMarketing, hideFromNonAdmins } from '@/lib/access'

const marketingRead: Access = ({ req: { user } }) => canReadMarketing(user)

export const ReleaseGateStatus: CollectionConfig = {
  slug: 'release-gate-status',
  admin: {
    group: 'Marketing',
    hidden: hideFromNonAdmins,
    description: 'Single-row projection of the billieChat application gate mode',
  },
  access: {
    read: marketingRead,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'gateId', type: 'text', required: true, unique: true, admin: { readOnly: true } },
    {
      name: 'mode',
      type: 'select',
      options: ['open', 'gated', 'closed'],
      admin: { readOnly: true },
    },
    { name: 'setBy', type: 'text', admin: { readOnly: true } },
    { name: 'changedAt', type: 'date', admin: { readOnly: true } },
  ],
  timestamps: true,
}
