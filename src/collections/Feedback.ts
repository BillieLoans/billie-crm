import type { CollectionConfig, Access } from 'payload'
import { canReadMarketing, hideFromNonAdmins } from '@/lib/access'

const marketingRead: Access = ({ req: { user } }) => canReadMarketing(user)

export const Feedback: CollectionConfig = {
  slug: 'feedback',
  admin: {
    useAsTitle: 'feedbackId',
    defaultColumns: ['feedbackId', 'contactIdString', 'feedbackType', 'status', 'receivedAt'],
    group: 'Marketing',
    hidden: hideFromNonAdmins,
    description: 'Marketing feedback + queue — read-only projection of marketingService events',
  },
  access: {
    read: marketingRead,
    create: () => false, // Only written by the event processor
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'feedbackId', type: 'text', required: true, unique: true, admin: { readOnly: true } },
    {
      name: 'contactIdString',
      type: 'text',
      index: true,
      admin: { readOnly: true, description: 'Marketing contact natural-key id' },
    },
    { name: 'customerId', type: 'text', index: true, admin: { readOnly: true } },
    // Free-text projections of marketingService event fields — kept as `text`
    // (not `select`) so the raw-SQL projection never fails on an unmodelled value.
    { name: 'feedbackType', type: 'text', admin: { readOnly: true } },
    { name: 'severity', type: 'text', admin: { readOnly: true } },
    { name: 'body', type: 'textarea', admin: { readOnly: true } },
    { name: 'productArea', type: 'text', index: true, admin: { readOnly: true } },
    { name: 'receivedAt', type: 'date', admin: { readOnly: true } },
    {
      name: 'status',
      type: 'text',
      index: true,
      admin: { readOnly: true, description: 'Queue triage status (new → acknowledged → resolved)' },
    },
    { name: 'statusChangedAt', type: 'date', admin: { readOnly: true } },
    { name: 'statusActor', type: 'text', admin: { readOnly: true } },
    {
      name: 'statusNote',
      type: 'textarea',
      admin: {
        readOnly: true,
        description: 'What was done — carried on feedback.status.changed.v1',
      },
    },
  ],
  timestamps: true,
}
