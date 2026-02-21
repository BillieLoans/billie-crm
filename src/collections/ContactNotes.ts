import type { CollectionConfig, Access } from 'payload'
import { z } from 'zod'
import { canService, isAdmin, hideFromNonAdmins } from '@/lib/access'

const tiptapContentSchema = z.object({
  type: z.literal('doc'),
  content: z.array(z.record(z.string(), z.unknown())).min(1),
})

/**
 * Access control: Any authenticated user can read contact notes
 */
const canRead: Access = ({ req }) => {
  return !!req.user
}

/**
 * Access control: Operations, Supervisor, and Admin can create contact notes
 */
const canCreate: Access = ({ req }) => {
  return canService(req.user)
}

/**
 * Access control: Operations, Supervisor, and Admin can update (only status field via beforeChange hook)
 */
const canUpdate: Access = ({ req }) => {
  return canService(req.user)
}

/**
 * Access control: Only Admin can delete contact notes
 */
const canDelete: Access = ({ req }) => {
  return isAdmin(req.user)
}

/**
 * Contact Notes Collection
 *
 * Immutable record of all human interactions with a customer. Notes can only be
 * corrected via the amendment chain — the original is preserved and marked
 * `amended`, while a new note is created with an `amendsNote` back-reference.
 *
 * Part of Epic 7: Customer Contact Notes.
 */
export const ContactNotes: CollectionConfig = {
  slug: 'contact-notes',
  admin: {
    useAsTitle: 'subject',
    group: 'Servicing',
    defaultColumns: ['noteType', 'subject', 'customer', 'status', 'createdAt'],
    description: 'Customer interaction notes — immutable audit trail',
    hidden: hideFromNonAdmins,
  },
  access: {
    read: canRead,
    create: canCreate,
    update: canUpdate,
    delete: canDelete,
  },
  hooks: {
    beforeValidate: [
      async ({ data }) => {
        if (!data || !('content' in data) || data.content == null) return data

        const validation = tiptapContentSchema.safeParse(data.content)
        if (!validation.success) {
          throw new Error('Invalid note content format. Expected Tiptap JSON document.')
        }

        return data
      },
    ],
    beforeChange: [
      async ({ data, operation, req }) => {
        if (operation === 'create') {
          // Auto-populate createdBy from the authenticated user
          if (req.user) {
            data.createdBy = req.user.id
          }
        }

        if (operation === 'update') {
          // Enforce immutability: only the status field may be changed after creation.
          // This prevents retroactive editing while allowing the amendment workflow
          // to mark the original note as `amended`.
          const allowedUpdateFields = new Set(['status'])
          for (const key of Object.keys(data)) {
            if (!allowedUpdateFields.has(key)) {
              delete data[key]
            }
          }

          // Enforce valid status transition: `status` can only be set to `amended`.
          // Prevents re-activating an already-amended note, which would corrupt
          // the immutable audit trail.
          if ('status' in data && data.status !== 'amended') {
            throw new Error(
              'Contact notes are immutable. The status field may only be set to `amended`.',
            )
          }
        }

        return data
      },
    ],
  },
  fields: [
    // ==========================================================================
    // Entity Relationships
    // ==========================================================================
    {
      name: 'customer',
      type: 'relationship',
      relationTo: 'customers',
      required: true,
      index: true,
      admin: {
        description: 'The customer this note relates to',
      },
    },
    {
      name: 'loanAccount',
      type: 'relationship',
      relationTo: 'loan-accounts',
      index: true,
      admin: {
        description: 'Linked loan account (optional — leave blank for general enquiries)',
      },
    },
    {
      name: 'application',
      type: 'relationship',
      relationTo: 'applications',
      admin: {
        description: 'Linked application (optional)',
      },
    },
    {
      name: 'conversation',
      type: 'relationship',
      relationTo: 'conversations',
      admin: {
        description: 'Linked conversation (optional)',
      },
    },
    // ==========================================================================
    // Note Classification
    // ==========================================================================
    {
      name: 'noteType',
      type: 'select',
      required: true,
      options: [
        { label: 'Phone — Inbound', value: 'phone_inbound' },
        { label: 'Phone — Outbound', value: 'phone_outbound' },
        { label: 'Email — Inbound', value: 'email_inbound' },
        { label: 'Email — Outbound', value: 'email_outbound' },
        { label: 'SMS', value: 'sms' },
        { label: 'General Enquiry', value: 'general_enquiry' },
        { label: 'Complaint', value: 'complaint' },
        { label: 'Escalation', value: 'escalation' },
        { label: 'Internal Note', value: 'internal_note' },
        { label: 'Account Update', value: 'account_update' },
        { label: 'Collections', value: 'collections' },
      ],
      admin: {
        description: 'Type of customer interaction',
      },
    },
    {
      name: 'contactDirection',
      type: 'select',
      options: [
        { label: 'Inbound', value: 'inbound' },
        { label: 'Outbound', value: 'outbound' },
      ],
      admin: {
        description: 'Direction of contact (for phone, email, and SMS note types)',
        condition: (data) =>
          ['phone_inbound', 'phone_outbound', 'email_inbound', 'email_outbound', 'sms'].includes(
            data?.noteType,
          ),
      },
    },
    // ==========================================================================
    // Note Content
    // ==========================================================================
    {
      name: 'subject',
      type: 'text',
      required: true,
      maxLength: 200,
      admin: {
        description: 'Brief subject line for the note (max 200 characters)',
      },
    },
    {
      name: 'content',
      type: 'json',
      required: true,
      admin: {
        description: 'Full note content (Tiptap JSON)',
      },
    },
    // ==========================================================================
    // Optional Metadata
    // ==========================================================================
    {
      name: 'priority',
      type: 'select',
      defaultValue: 'normal',
      options: [
        { label: 'Low', value: 'low' },
        { label: 'Normal', value: 'normal' },
        { label: 'High', value: 'high' },
        { label: 'Urgent', value: 'urgent' },
      ],
      admin: {
        description: 'Note priority (hidden in timeline when Normal)',
      },
    },
    {
      name: 'sentiment',
      type: 'select',
      defaultValue: 'neutral',
      options: [
        { label: 'Positive', value: 'positive' },
        { label: 'Neutral', value: 'neutral' },
        { label: 'Negative', value: 'negative' },
        { label: 'Escalation', value: 'escalation' },
      ],
      admin: {
        description: 'Sentiment of the interaction (hidden in timeline when Neutral)',
      },
    },
    // ==========================================================================
    // Authorship
    // ==========================================================================
    {
      name: 'createdBy',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      admin: {
        readOnly: true,
        description: 'User who created this note (auto-populated from session)',
        position: 'sidebar',
      },
    },
    // ==========================================================================
    // Amendment Chain
    // ==========================================================================
    {
      name: 'amendsNote',
      type: 'relationship',
      // Self-referential: points back to the note this is correcting
      relationTo: 'contact-notes',
      index: true,
      admin: {
        readOnly: true,
        description: 'The original note this amendment corrects (set automatically by the amendment workflow)',
        position: 'sidebar',
        condition: (data) => !!data?.amendsNote,
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'active',
      options: [
        { label: 'Active', value: 'active' },
        { label: 'Amended', value: 'amended' },
      ],
      index: true,
      admin: {
        description: 'Active = current version. Amended = superseded by a newer amendment.',
        position: 'sidebar',
      },
    },
    // ==========================================================================
    // Timestamp Index Override
    // `timestamps: true` adds createdAt/updatedAt fields but does NOT index them
    // by default. The timeline query (Story 7.2) sorts by createdAt DESC across
    // potentially thousands of notes per customer — an index is essential.
    // ==========================================================================
    {
      name: 'createdAt',
      type: 'date',
      index: true,
      admin: {
        readOnly: true,
        position: 'sidebar',
        description: 'Note creation timestamp (auto-set)',
      },
    },
  ],
  timestamps: true,
}
