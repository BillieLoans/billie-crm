import type { CollectionConfig, Access } from 'payload'
import { canReadMarketing, hideFromNonAdmins } from '@/lib/access'

const marketingRead: Access = ({ req: { user } }) => canReadMarketing(user)

export const ContactAuditLog: CollectionConfig = {
  slug: 'contact-audit-log',
  admin: {
    useAsTitle: 'eventType',
    defaultColumns: ['contactIdString', 'eventType', 'actor', 'occurredAt'],
    group: 'Marketing',
    hidden: hideFromNonAdmins,
    description: 'Marketing contact audit trail — read-only projection of marketingService events',
  },
  access: {
    read: marketingRead,
    create: () => false, // Only written by the event processor
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'contactIdString',
      type: 'text',
      required: true,
      index: true,
      admin: { readOnly: true },
    },
    { name: 'eventType', type: 'text', required: true, admin: { readOnly: true } },
    { name: 'actor', type: 'text', admin: { readOnly: true } },
    { name: 'occurredAt', type: 'date', index: true, admin: { readOnly: true } },
    { name: 'detail', type: 'json', admin: { readOnly: true } },
  ],
  timestamps: true,
}
