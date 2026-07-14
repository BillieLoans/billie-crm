import { z } from 'zod'

/**
 * Public contract for the waitlist intake route (POST /api/intake/waitlist).
 * Field names are snake_case to match what the marketing site's form posts
 * and what the platform's `build_contact_observed` command payload expects
 * (see src/app/api/intake/waitlist/route.ts).
 */
export const WaitlistIntakeSchema = z
  .object({
    idempotency_key: z.string().max(128).optional(),
    first_name: z.string().max(100).optional(),
    email: z.email().optional(),
    mobile: z.string().max(20).optional(),
    city: z.string().max(100).optional(),
    postcode: z.string().max(10).optional(),
    source: z
      .enum(['meta', 'google', 'campus', 'referral', 'social_dm', 'ai_search', 'word_of_mouth', 'organic', 'other'])
      .default('other'),
    utm: z.record(z.string(), z.string()).optional(),
    platforms: z.array(z.string()).optional(),
    channel_preference: z.enum(['whatsapp', 'sms']).optional(),
    ref: z.string().max(12).optional(),
    consent: z.object({
      granted: z.boolean(),
      channels: z.array(z.enum(['sms', 'whatsapp', 'email'])).default(['sms']),
      method: z.string().max(50),
    }),
  })
  .refine((d) => !!d.mobile || !!d.email, { message: 'mobile or email is required' })

export type WaitlistIntake = z.infer<typeof WaitlistIntakeSchema>

/**
 * Public contract for the feedback intake route (POST /api/intake/feedback).
 * snake_case to match the marketingService `SubmitFeedback` command fields.
 * `contact_id` is required — the public feedback form carries it (e.g. from a
 * feedback-prompt link); anonymous feedback is out of scope for phase 2.
 */
export const FeedbackIntakeSchema = z.object({
  idempotency_key: z.string().max(128).optional(),
  contact_id: z.string().min(1).max(128),
  customer_id: z.string().max(128).optional(),
  type: z.string().min(1).max(50), // bug | praise | feature | complaint | ...
  severity: z.string().max(50).optional(),
  text: z.string().min(1).max(5000),
  product_area: z.string().max(100).optional(),
})

export type FeedbackIntake = z.infer<typeof FeedbackIntakeSchema>
