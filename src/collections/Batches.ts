import type { CollectionConfig, Access } from 'payload'
import { canReadMarketing, hideFromNonAdmins } from '@/lib/access'

const marketingRead: Access = ({ req: { user } }) => canReadMarketing(user)

export const Batches: CollectionConfig = {
  slug: 'batches',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'batchId', 'batchCreatedAt'],
    group: 'Marketing',
    hidden: hideFromNonAdmins,
    description: 'Marketing batch definitions — read-only projection of marketingService events',
  },
  access: {
    read: marketingRead,
    create: () => false, // Only written by the event processor
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'batchId', type: 'text', required: true, unique: true, admin: { readOnly: true } },
    { name: 'name', type: 'text', admin: { readOnly: true } },
    {
      name: 'criteria',
      type: 'json',
      admin: { readOnly: true, description: 'Segment filter the batch was created from' },
    },
    { name: 'createdByActor', type: 'text', admin: { readOnly: true } },
    { name: 'batchCreatedAt', type: 'date', admin: { readOnly: true } },
    {
      name: 'invitedAt',
      type: 'date',
      admin: { readOnly: true, description: 'When invitations were last triggered' },
    },
    { name: 'invitedCount', type: 'number', admin: { readOnly: true } },
    { name: 'skippedUnconsented', type: 'number', admin: { readOnly: true } },
    { name: 'skippedNeedsReview', type: 'number', admin: { readOnly: true } },
  ],
  timestamps: true,
}
