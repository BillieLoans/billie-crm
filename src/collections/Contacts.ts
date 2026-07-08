import type { CollectionConfig, Access } from 'payload'
import { canReadMarketing, hideFromNonAdmins } from '@/lib/access'

const marketingRead: Access = ({ req: { user } }) => canReadMarketing(user)

export const Contacts: CollectionConfig = {
  slug: 'contacts',
  admin: {
    useAsTitle: 'firstName',
    defaultColumns: ['firstName', 'mobileE164', 'derivedStage', 'source'],
    group: 'Marketing',
    hidden: hideFromNonAdmins,
    description: 'Marketing contact facet — read-only projection of marketingService events',
  },
  access: {
    read: marketingRead,
    create: () => false, // Only written by the event processor
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'contactId', type: 'text', required: true, unique: true, admin: { readOnly: true } },
    { name: 'firstName', type: 'text', admin: { readOnly: true } },
    { name: 'email', type: 'email', index: true, admin: { readOnly: true } },
    { name: 'mobileE164', type: 'text', index: true, admin: { readOnly: true } },
    { name: 'city', type: 'text', admin: { readOnly: true } },
    { name: 'postcode', type: 'text', admin: { readOnly: true } },
    {
      name: 'source',
      type: 'select',
      options: [
        'meta',
        'google',
        'campus',
        'referral',
        'social_dm',
        'ai_search',
        'organic',
        'other',
      ],
      admin: { readOnly: true },
    },
    { name: 'utm', type: 'json', admin: { readOnly: true } },
    { name: 'platforms', type: 'json', admin: { readOnly: true } },
    {
      name: 'channelPreference',
      type: 'select',
      options: ['whatsapp', 'sms'],
      admin: { readOnly: true },
    },
    { name: 'referralCode', type: 'text', index: true, admin: { readOnly: true } },
    { name: 'referredByContactId', type: 'text', index: true, admin: { readOnly: true } },
    { name: 'waitlistJoinedAt', type: 'date', admin: { readOnly: true } },
    { name: 'waitlistPosition', type: 'number', admin: { readOnly: true } },
    { name: 'batchId', type: 'text', admin: { readOnly: true } },
    { name: 'panelMember', type: 'checkbox', admin: { readOnly: true } },
    {
      name: 'needsReview',
      type: 'checkbox',
      index: true,
      admin: {
        readOnly: true,
        description:
          'A2 flag (attributes.needs_review mirror) — parked for staff review; excluded from invitation sends',
      },
    },
    {
      name: 'customerId',
      type: 'text',
      index: true,
      admin: {
        readOnly: true,
        description: 'Canonical platform customer id once linked (one-way)',
      },
    },
    { name: 'linkBasis', type: 'text', admin: { readOnly: true } },
    { name: 'linkedAt', type: 'date', admin: { readOnly: true } },
    {
      name: 'derivedStage',
      type: 'select',
      options: ['lead', 'waitlist', 'invited', 'applicant', 'customer', 'former_customer'],
      index: true,
      admin: { readOnly: true, description: 'Derived by marketingService — never hand-edited' },
    },
    {
      name: 'loanStatus',
      type: 'select',
      options: ['approved', 'disbursed', 'repaid'],
      admin: { readOnly: true, description: 'Minimal mirror only — no financial detail, ever' },
    },
    { name: 'consent', type: 'json', admin: { readOnly: true } },
    { name: 'attributes', type: 'json', admin: { readOnly: true } },
    { name: 'erased', type: 'checkbox', admin: { readOnly: true } },
    {
      name: 'mergedInto',
      type: 'text',
      admin: {
        readOnly: true,
        description: 'Survivor contact_id after a merge — merged records are hidden from the grid',
      },
    },
    { name: 'observedAt', type: 'date', admin: { readOnly: true } },
  ],
  timestamps: true,
}
