import { z } from 'zod'

/**
 * Staff-facing marketing command contracts (Task C5).
 *
 * Field names are snake_case to match the public waitlist intake contract
 * (`@/lib/schemas/intake`) and the platform's marketingService command
 * vocabulary. Routes translate these into the gRPC client's camelCase
 * request shape (`@/server/marketing-grpc-client`).
 */

const assertedContactFields = {
  first_name: z.string().max(100).optional(),
  email: z.email().optional(),
  mobile: z.string().max(20).optional(),
  city: z.string().max(100).optional(),
  postcode: z.string().max(10).optional(),
  channel_preference: z.enum(['whatsapp', 'sms']).optional(),
}

/**
 * Staff-initiated contact creation. Unlike the public waitlist intake
 * schema, consent is NOT required here — a staff member may be recording a
 * contact captured through an offline channel (e.g. a phone call) where
 * consent capture is a separate follow-up step via the consent route.
 *
 * No `attributes` field: UpsertContactRequest (the gRPC message the create
 * route calls) has no attributes slot — only UpdateContactRequest does.
 * Set attributes via a follow-up PATCH once the contact exists.
 */
export const CreateContactSchema = z
  .object({
    ...assertedContactFields,
    source: z
      .enum(['meta', 'google', 'campus', 'referral', 'social_dm', 'ai_search', 'word_of_mouth', 'organic', 'other'])
      .default('other'),
  })
  .refine((d) => !!d.mobile || !!d.email, { message: 'mobile or email is required' })

export type CreateContact = z.infer<typeof CreateContactSchema>

/** Partial update — every asserted field is optional, no cross-field refine. */
export const UpdateContactSchema = z.object({
  ...assertedContactFields,
  attributes: z.record(z.string(), z.unknown()).optional(),
})

export type UpdateContact = z.infer<typeof UpdateContactSchema>

export const SetConsentSchema = z.object({
  granted: z.boolean(),
  channels: z.array(z.enum(['sms', 'whatsapp', 'email'])).default(['sms']),
  method: z.string().max(50),
  evidence: z.string().max(500).optional(),
})

export type SetConsent = z.infer<typeof SetConsentSchema>

export const LogInteractionSchema = z.object({
  kind: z.enum(['note', 'message_out', 'message_in']),
  channel: z.string().max(50).optional(),
  direction: z.enum(['inbound', 'outbound']).optional(),
  subject: z.string().max(200).optional(),
  body: z.string().max(5000).optional(),
  occurred_at: z.string().optional(),
  source_system: z.string().max(50).default('crm'),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type LogInteraction = z.infer<typeof LogInteractionSchema>

/**
 * Phase-2 (Stream A) staff command contracts — batches + feedback triage.
 */

export const CreateBatchSchema = z.object({
  name: z.string().min(1).max(200),
  criteria: z.record(z.string(), z.unknown()).optional(),
})

export type CreateBatch = z.infer<typeof CreateBatchSchema>

export const AssignBatchSchema = z.object({
  contact_ids: z.array(z.string().min(1)).min(1).max(10000),
})

export type AssignBatch = z.infer<typeof AssignBatchSchema>

export const LinkContactSchema = z.object({
  customer_id: z.string().min(1).max(128),
})

export type LinkContact = z.infer<typeof LinkContactSchema>

export const SetFeedbackStatusSchema = z
  .object({
    status: z.enum(['new', 'acknowledged', 'resolved']),
    // What was done with the feedback. Required when resolving (matches the
    // approval flows' comment requirement); optional on acknowledge.
    note: z.string().max(2000).optional(),
  })
  .refine((d) => d.status !== 'resolved' || !!d.note?.trim(), {
    message: 'A resolution note is required when resolving feedback',
    path: ['note'],
  })

export type SetFeedbackStatus = z.infer<typeof SetFeedbackStatusSchema>
