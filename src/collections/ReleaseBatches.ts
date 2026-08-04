import type { CollectionConfig, Access } from 'payload'
import { canReadMarketing, hideFromNonAdmins } from '@/lib/access'

const marketingRead: Access = ({ req: { user } }) => canReadMarketing(user)

export const ReleaseBatches: CollectionConfig = {
  slug: 'release-batches',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'releaseId', 'type', 'status', 'releasedAt'],
    group: 'Marketing',
    hidden: hideFromNonAdmins,
    description: 'Applicant release batches — read-only projection of applicant_release events',
  },
  access: {
    read: marketingRead,
    create: () => false, // Only written by the event processor
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'releaseId', type: 'text', required: true, unique: true, admin: { readOnly: true } },
    { name: 'name', type: 'text', admin: { readOnly: true } },
    {
      name: 'type',
      type: 'select',
      options: ['waitlist', 'phone_list', 'open_quota'],
      admin: { readOnly: true },
    },
    {
      name: 'status',
      type: 'select',
      options: ['active', 'revoked'],
      admin: { readOnly: true, description: 'Expired is derived from expiresAt at read time' },
    },
    { name: 'quotaCount', type: 'number', admin: { readOnly: true } },
    { name: 'expiresAt', type: 'date', admin: { readOnly: true } },
    { name: 'sendInviteSms', type: 'checkbox', admin: { readOnly: true } },
    { name: 'grantedCount', type: 'number', admin: { readOnly: true } },
    { name: 'claimedCount', type: 'number', admin: { readOnly: true } },
    { name: 'smsSentCount', type: 'number', admin: { readOnly: true } },
    { name: 'smsFailedCount', type: 'number', admin: { readOnly: true } },
    { name: 'skippedAlreadyCustomer', type: 'number', admin: { readOnly: true } },
    { name: 'skippedInvalidNumber', type: 'number', admin: { readOnly: true } },
    { name: 'skippedAlreadyReleased', type: 'number', admin: { readOnly: true } },
    { name: 'skippedNeedsReview', type: 'number', admin: { readOnly: true } },
    { name: 'createdByActor', type: 'text', admin: { readOnly: true } },
    { name: 'releasedAt', type: 'date', admin: { readOnly: true } },
    { name: 'revokedBy', type: 'text', admin: { readOnly: true } },
    { name: 'revokedAt', type: 'date', admin: { readOnly: true } },
  ],
  timestamps: true,
}
