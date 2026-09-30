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
  'cancelled',
  'expired',
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
  customer: z
    .object({
      fullName: z.string().nullable().optional(),
      customerId: z.string().nullable().optional(),
    })
    .optional(),
  applicationNumber: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  decisionStatus: z.string().nullable().optional(),
  application: z
    .object({
      loanAmount: z.number().nullable().optional(),
      purpose: z.string().nullable().optional(),
    })
    .optional(),
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

export const KillRecordSchema = z.object({
  request_id: z.string().nullable().optional(),
  actor: z.string().nullable().optional(),
  /** Render-time resolved display name for `actor` (CRM-only; not stored). */
  actorName: z.string().nullable().optional(),
  reason_category: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  killed_at: z.string().nullable().optional(),
})

/** Cancellation / expiry audit written by the event processor (spec: 2026-08-28). */
export const CancellationRecordSchema = z.object({
  reason: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  cancelled_at: z.string().nullable().optional(),
  source_event: z.string().nullable().optional(),
  application_number: z.string().nullable().optional(),
})

/**
 * Identity-recognition context attached to a review-kind halt.
 *
 * Stored verbatim from the event payload's `recognition` object (a Payload
 * `json` column projects it untouched), so the keys here mirror the event's
 * snake_case — unlike the camelCase scalar columns around it.
 */
export const RecognitionCandidateSchema = z.object({
  candidate_id: z.string().nullable().optional(),
  /** This candidate's match score, 0..1. */
  posterior: z.number().nullable().optional(),
  /** Applicant appears to be concealing the prior identity. */
  concealment: z.boolean().nullable().optional(),
  /**
   * Evidence weight per signal: positive = the signal agrees (same person),
   * negative = it disagrees. Magnitude = strength. `name`/`dob` are the identity
   * core; `email`/`bank`/`address`/`phone` are corroborating hints.
   */
  per_signal_bits: z.record(z.string(), z.number()).nullable().optional(),
})

export type RecognitionCandidate = z.infer<typeof RecognitionCandidateSchema>

export const RecognitionSchema = z.object({
  /** "review" for review halts; null for eligibility blocks. */
  band: z.string().nullable().optional(),
  /** Overall match confidence, 0..1 (render as %). */
  posterior: z.number().nullable().optional(),
  case_id: z.string().nullable().optional(),
  /** Matched prior customers, even weak ones; [] for eligibility blocks. */
  candidates: z.array(RecognitionCandidateSchema).nullable().optional(),
})

export type Recognition = z.infer<typeof RecognitionSchema>

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
  /**
   * A halt is one of two kinds:
   * - "block": a confirmed eligibility block (active loan / default / …). Render
   *   the reason/window/source detail (recognition.candidates is empty).
   * - "review": NOT a confirmed block — flagged as a probable returning customer
   *   and auto-held for manual review. Surface the recognition match context.
   */
  dispositionKind: z.enum(['review', 'block']).nullable().optional(),
  manualReviewCandidate: z.boolean().nullable().optional(),
  recognition: RecognitionSchema.nullable().optional(),
  clearStatus: z.string().nullish(),
  clearedAt: z.string().nullish(),
  clearedBy: z.string().nullish(),
  clearJustification: z.string().nullish(),
  clearRequestId: z.string().nullish(),
})

/** Archived KYC artifact availability (S3 locations stay server-side). */
export const IdentityVerificationReportSchema = z.object({
  labRequestId: z.string().nullable().optional(),
  providerReference: z.string().nullable().optional(),
  reportAvailable: z.boolean().optional(),
  reportFileName: z.string().nullable().optional(),
  rawResponseAvailable: z.boolean().optional(),
  rawResponseFileName: z.string().nullable().optional(),
  /** LAB API v1: per-check reports — the screening PDF is a separate artifact. */
  verificationNumber: z.string().nullable().optional(),
  screeningReportAvailable: z.boolean().optional(),
  screeningReportFileName: z.string().nullable().optional(),
  archivedAt: z.union([z.string(), z.date()]).nullable().optional(),
})

/**
 * One LAB verify call (billieChat spec 2026-09-15). Shaped by
 * `shapeAttempts` — S3 locations never reach the browser.
 */
export const IdentityVerificationAttemptSchema = z.object({
  key: z.string(),
  attemptNumber: z.number(),
  stepUp: z.boolean(),
  stepUpRequested: z.boolean(),
  documentTypes: z.array(z.string()),
  decision: z.string().nullable(),
  identityVerificationFailed: z.boolean(),
  screeningHit: z.boolean(),
  pepResult: z.string().nullable(),
  sanctionsResult: z.string().nullable(),
  labVerification: z.record(z.string(), z.unknown()).nullable(),
  labRequestId: z.string().nullable(),
  checkedAt: z.string().nullable(),
  reportAvailable: z.boolean(),
  reportFileName: z.string().nullable(),
  rawResponseAvailable: z.boolean(),
  rawResponseFileName: z.string().nullable(),
  /** LAB API v1 only: the screening check's own report PDF for this call. */
  screeningReportAvailable: z.boolean(),
  screeningReportFileName: z.string().nullable(),
  archivedAt: z.string().nullable(),
})

/**
 * BTB-392: what the platform decided about this journey's identity, shaped by
 * `shapeIdentityResolution` from `conversations.identity_resolution`.
 */
export const IdentityLinkOutcomeSchema = z.object({
  canonicalId: z.string().nullable(),
  aliasId: z.string().nullable(),
  linkId: z.string().nullable(),
  reason: z.string().nullable(),
  at: z.string().nullable(),
})

export const ResolverAssessmentSchema = z.object({
  eventId: z.string(),
  assessedAt: z.string().nullable(),
  candidateId: z.string().nullable(),
  verdict: z.string().nullable(),
  confidence: z.number().nullable(),
  factors: z.array(z.string()),
  mode: z.string().nullable(),
  applied: z.boolean().nullable(),
  platformReasonCode: z.string().nullable(),
  latencyMs: z.number().nullable(),
  model: z.string().nullable(),
})

export const ReviewCaseSchema = z.object({
  caseId: z.string().nullable(),
  band: z.string().nullable(),
  posterior: z.number().nullable(),
  flags: z.array(z.string()),
  candidateIds: z.array(z.string()),
  perSignalBits: z.record(z.string(), z.number()).nullable(),
  recommendation: z.string().nullable(),
  disposition: z.string().nullable(),
  relatedJourneys: z.array(z.string()),
  openedAt: z.string().nullable(),
})

export const IdentityResolutionSchema = z.object({
  link: IdentityLinkOutcomeSchema.nullable(),
  merge: IdentityLinkOutcomeSchema.nullable(),
  resolverAssessments: z.array(ResolverAssessmentSchema),
  reviewCase: ReviewCaseSchema.nullable(),
})

export type IdentityResolution = z.infer<typeof IdentityResolutionSchema>
export type ResolverAssessment = z.infer<typeof ResolverAssessmentSchema>

export const ConversationDetailSchema = z.object({
  conversationId: z.string(),
  applicationNumber: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  decisionStatus: z.string().nullable().optional(),
  finalDecision: z.string().nullable().optional(),
  decisionDetail: DecisionDetailSchema.nullable().optional(),
  killRecord: KillRecordSchema.nullable().optional(),
  cancellationRecord: CancellationRecordSchema.nullable().optional(),
  reapplicationBlock: ReapplicationBlockSchema.nullable().optional(),
  /** Conversation id of the prior decline referenced by a block (deep-link target). */
  sourceConversationId: z.string().nullable().optional(),
  identityVerificationReport: IdentityVerificationReportSchema.nullable().optional(),
  /** Every LAB verify call for this application, ascending attempt number. */
  identityVerificationAttempts: z.array(IdentityVerificationAttemptSchema).nullable().optional(),
  /** BTB-392: platform link outcome, resolver assessments and review case for this journey. */
  identityResolution: IdentityResolutionSchema.nullable().optional(),
  /** BTB-392: the customer id this conversation arrived under before an identity link moved it. */
  identityOriginCustomerId: z.string().nullable().optional(),
  startedAt: z.union([z.string(), z.date()]).nullable().optional(),
  updatedAt: z.union([z.string(), z.date()]).nullable().optional(),
  lastMessageAt: z.union([z.string(), z.date()]).nullable().optional(),
  /**
   * Cumulative LLM cost roll-up for this application (BTB-302), maintained on
   * the conversation record by the event processor. Authoritative for display —
   * the per-call `llm-costs` rows are the supervisor-only audit trail.
   */
  llmCostTotalUsd: z.number().nullable().optional(),
  llmCallCount: z.number().nullable().optional(),
  /** Calls whose model was missing from the rate table — should be zero. */
  llmUnpricedCount: z.number().nullable().optional(),
  customer: z
    .object({
      fullName: z.string().nullable().optional(),
      customerId: z.string().nullable().optional(),
      payloadId: z.string().nullable().optional(),
      preferredName: z.string().nullable().optional(),
      emailAddress: z.string().nullable().optional(),
      mobilePhoneNumber: z.string().nullable().optional(),
      dateOfBirth: z.string().nullable().optional(),
      identityVerified: z.boolean().nullable().optional(),
      residentialAddress: z.string().nullable().optional(),
    })
    .optional(),
  application: z
    .object({
      loanAmount: z.number().nullable().optional(),
      purpose: z.string().nullable().optional(),
      term: z.number().nullable().optional(),
    })
    .optional(),
  utterances: z.array(UtteranceSchema).default([]),
  assessments: z.record(z.string(), z.unknown()).optional(),
  statementCapture: z.unknown().optional(),
  noticeboard: z.array(NoticeboardEntrySchema).default([]),
  summary: z
    .object({
      purpose: z.string().nullable().optional(),
      facts: z.array(z.object({ fact: z.string() })).optional(),
    })
    .optional(),
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
