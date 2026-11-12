import { z } from 'zod'

const id = z.string().trim().min(1)

/** Which applications a statement deletion covers. */
export const DeletionScopeSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('application'), conversationId: id }),
  z.object({ scope: z.literal('customer'), customerIdString: id }),
])

export const DeletionRequestSchema = DeletionScopeSchema.and(
  z.object({ reason: z.string().trim().min(1).max(500) }),
)
