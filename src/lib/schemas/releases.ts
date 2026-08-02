import { z } from 'zod'
import { RELEASE_TYPES } from '@/lib/events/config'

/**
 * Staff command to release a batch of applicants (spec §5). releaseId is
 * minted client-side (nanoid) so retries are idempotent end-to-end.
 */
export const CreateReleaseCommandSchema = z
  .object({
    releaseId: z.string().min(8),
    name: z.string().min(1).max(200),
    type: z.enum(RELEASE_TYPES),
    count: z.number().int().min(1).optional(),
    mobiles: z.array(z.string().min(1)).min(1).max(1000).optional(),
    expiryDays: z.number().int().min(1).max(90).default(14),
    sendInviteSms: z.boolean().default(false),
  })
  .refine((d) => d.type === 'phone_list' || d.count !== undefined, {
    message: 'waitlist and open_quota releases need a count',
    path: ['count'],
  })
  .refine((d) => d.type !== 'phone_list' || !!d.mobiles, {
    message: 'phone_list releases need mobiles',
    path: ['mobiles'],
  })
  .refine((d) => !(d.type !== 'phone_list' && d.mobiles), {
    message: 'mobiles only applies to phone_list releases',
    path: ['mobiles'],
  })
  .refine((d) => !(d.type === 'open_quota' && d.sendInviteSms), {
    message: 'An open quota has no recipients to SMS',
    path: ['sendInviteSms'],
  })
export type CreateReleaseCommand = z.infer<typeof CreateReleaseCommandSchema>

export const RevokeReleaseCommandSchema = z.object({
  reason: z.string().max(500).optional(),
})
export type RevokeReleaseCommand = z.infer<typeof RevokeReleaseCommandSchema>
