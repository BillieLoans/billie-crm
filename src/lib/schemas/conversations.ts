import { z } from 'zod'

// =============================================================================
// Conversation status constants
// =============================================================================

export const CONVERSATION_STATUSES = [
  'active',
  'paused',
  'soft_end',
  'hard_end',
  'approved',
  'declined',
  'ended',
] as const

export const DECISION_STATUSES = ['approved', 'declined', 'referred', 'no_decision'] as const

export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number]
export type DecisionStatus = (typeof DECISION_STATUSES)[number]

// =============================================================================
// List endpoint schemas
// =============================================================================

export const ConversationsQuerySchema = z.object({
  status: z.string().optional(),
  decision: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
})

export type ConversationsQuery = z.infer<typeof ConversationsQuerySchema>

export const ConversationSummarySchema = z.object({
  conversationId: z.string(),
  customer: z.object({
    fullName: z.string().nullable().optional(),
    customerId: z.string().nullable().optional(),
  }).optional(),
  applicationNumber: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  decisionStatus: z.string().nullable().optional(),
  application: z.object({
    loanAmount: z.number().nullable().optional(),
    purpose: z.string().nullable().optional(),
  }).optional(),
  messageCount: z.number().default(0),
  lastMessageAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
})

export type ConversationSummary = z.infer<typeof ConversationSummarySchema>

export const ConversationsListResponseSchema = z.object({
  conversations: z.array(ConversationSummarySchema),
  cursor: z.string().nullable(),
  hasMore: z.boolean(),
  total: z.number(),
})

export type ConversationsListResponse = z.infer<typeof ConversationsListResponseSchema>

// =============================================================================
// Detail endpoint schemas
// =============================================================================

export const UtteranceSchema = z.object({
  username: z.string().nullable().optional(),
  utterance: z.string(),
  rationale: z.string().nullable().optional(),
  createdAt: z.union([z.string(), z.date()]).nullable().optional(),
  answerInputType: z.string().nullable().optional(),
  endConversation: z.boolean().default(false),
  additionalData: z.unknown().optional(),
})

export const NoticeboardEntrySchema = z.object({
  agentName: z.string().nullable().optional(),
  topic: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  timestamp: z.union([z.string(), z.date()]).nullable().optional(),
})

/** Optional detail accompanying final_credit_decision (BTB-135). */
export const DecisionDetailSchema = z.object({
  reason: z.string().nullable().optional(),
  retryEligible: z.boolean().nullable().optional(),
  sourceApplicationNumber: z.string().nullable().optional(),
  blockedUntil: z.union([z.string(), z.date()]).nullable().optional(),
})

/** application.reapplication_blocked.v1 — the rich "why" behind a block-decline. */
export const ReapplicationBlockSchema = z.object({
  reason: z.string().nullable().optional(),
  messageVariant: z.string().nullable().optional(),
  stopMessage: z.string().nullable().optional(),
  sourceApplicationNumber: z.string().nullable().optional(),
  sourceAccountId: z.string().nullable().optional(),
  sourceDecidedAt: z.union([z.string(), z.date()]).nullable().optional(),
  /**
   * null = permanent (PEP, PRIOR_DEFAULT, IDENTITY_CONFLICT) or while-loan-open
   * (ACTIVE_LOAN); a dated value for the decline windows and PRIOR_SERIOUS_ARREARS
   * (BTB-154 — cured serious arrears/default, 12 months from loan closure).
   */
  blockedUntil: z.union([z.string(), z.date()]).nullable().optional(),
  blockedAt: z.union([z.string(), z.date()]).nullable().optional(),
  canonicalCustomerId: z.string().nullable().optional(),
})

/** Archived KYC artifact availability (S3 locations stay server-side). */
export const IdentityVerificationReportSchema = z.object({
  labRequestId: z.string().nullable().optional(),
  providerReference: z.string().nullable().optional(),
  reportAvailable: z.boolean().optional(),
  reportFileName: z.string().nullable().optional(),
  rawResponseAvailable: z.boolean().optional(),
  rawResponseFileName: z.string().nullable().optional(),
  archivedAt: z.union([z.string(), z.date()]).nullable().optional(),
})

export const ConversationDetailSchema = z.object({
  conversationId: z.string(),
  applicationNumber: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  decisionStatus: z.string().nullable().optional(),
  finalDecision: z.string().nullable().optional(),
  decisionDetail: DecisionDetailSchema.nullable().optional(),
  reapplicationBlock: ReapplicationBlockSchema.nullable().optional(),
  /** Conversation id of the prior decline referenced by a block (deep-link target). */
  sourceConversationId: z.string().nullable().optional(),
  identityVerificationReport: IdentityVerificationReportSchema.nullable().optional(),
  startedAt: z.union([z.string(), z.date()]).nullable().optional(),
  updatedAt: z.union([z.string(), z.date()]).nullable().optional(),
  lastMessageAt: z.union([z.string(), z.date()]).nullable().optional(),
  customer: z.object({
    fullName: z.string().nullable().optional(),
    customerId: z.string().nullable().optional(),
    payloadId: z.string().nullable().optional(),
  }).optional(),
  application: z.object({
    loanAmount: z.number().nullable().optional(),
    purpose: z.string().nullable().optional(),
    term: z.number().nullable().optional(),
  }).optional(),
  utterances: z.array(UtteranceSchema).default([]),
  assessments: z.record(z.string(), z.unknown()).optional(),
  statementCapture: z.unknown().optional(),
  noticeboard: z.array(NoticeboardEntrySchema).default([]),
  summary: z.object({
    purpose: z.string().nullable().optional(),
    facts: z.array(z.object({ fact: z.string() })).optional(),
  }).optional(),
  messageCount: z.number().default(0),
})

export type ConversationDetail = z.infer<typeof ConversationDetailSchema>

export const ConversationDetailResponseSchema = z.object({
  conversation: ConversationDetailSchema,
})

// =============================================================================
// Assessment S3 proxy schemas
// =============================================================================

export const AssessmentProxyResponseSchema = z.object({
  assessment: z.record(z.string(), z.unknown()),
})
