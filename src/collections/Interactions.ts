import type { CollectionConfig, Access } from 'payload'
import { canReadMarketing, hideFromNonAdmins } from '@/lib/access'

const marketingRead: Access = ({ req: { user } }) => canReadMarketing(user)

export const Interactions: CollectionConfig = {
  slug: 'interactions',
  admin: {
    useAsTitle: 'interactionId',
    defaultColumns: ['interactionId', 'contactIdString', 'kind', 'occurredAt'],
    group: 'Marketing',
    hidden: hideFromNonAdmins,
    description: 'Marketing interaction timeline — read-only projection of marketingService events',
  },
  access: {
    read: marketingRead,
    create: () => false, // Only written by the event processor
    update: () => false,
    delete: () => false,
  },
  fields: [
    {
      name: 'interactionId',
      type: 'text',
      required: true,
      unique: true,
      admin: { readOnly: true },
    },
    {
      name: 'contactIdString',
      type: 'text',
      required: true,
      index: true,
      admin: { readOnly: true },
    },
    {
      name: 'contact',
      type: 'relationship',
      relationTo: 'contacts',
      index: true,
      admin: {
        readOnly: true,
        description: 'Set by the processor when the contact row exists',
      },
    },
    { name: 'occurredAt', type: 'date', index: true, admin: { readOnly: true } },
    {
      name: 'kind',
      type: 'select',
      options: [
        'signup',
        'message_out',
        'message_in',
        'feedback_prompt',
        'referral',
        'stage_change',
        'note',
        'import',
      ],
      admin: { readOnly: true },
    },
    { name: 'channel', type: 'text', admin: { readOnly: true } },
    {
      name: 'direction',
      type: 'select',
      options: ['inbound', 'outbound'],
      admin: { readOnly: true },
    },
    { name: 'subject', type: 'text', admin: { readOnly: true } },
    { name: 'body', type: 'textarea', admin: { readOnly: true } },
    { name: 'sourceSystem', type: 'text', admin: { readOnly: true } },
    { name: 'metadata', type: 'json', admin: { readOnly: true } },
  ],
  timestamps: true,
}
