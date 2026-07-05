import { z } from 'zod'

/**
 * ClickSend inbound-SMS webhook payload (POST /api/webhooks/clicksend).
 *
 * Field names match ClickSend's inbound SMS rule delivery. Only `from` (sender
 * mobile — resolved to a contact downstream) is required; everything else is
 * optional so a config or format variation never 400s a genuine inbound. The
 * route accepts both form-urlencoded (ClickSend default) and JSON delivery.
 *
 * See https://developers.clicksend.com/docs/messaging/sms
 */
export const ClickSendInboundSchema = z.object({
  from: z.string().min(1),
  body: z.string().default(''),
  to: z.string().optional(),
  message_id: z.string().optional(),
  timestamp: z.union([z.string(), z.number()]).optional(),
  timestamp_send: z.union([z.string(), z.number()]).optional(),
  custom_string: z.string().optional(),
  original_body: z.string().optional(),
  original_message_id: z.string().optional(),
  _keyword: z.string().optional(),
})

export type ClickSendInbound = z.infer<typeof ClickSendInboundSchema>
