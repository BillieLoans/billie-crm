/**
 * gRPC Client for the platform's MarketingService.
 *
 * Provides typed interfaces for contact upsert/update, consent, interaction
 * logging, and erasure. This is the primary write path for the public
 * waitlist intake route (src/app/api/intake/waitlist/route.ts), which falls
 * back to a durable Redis stream command when gRPC is unavailable so a
 * signup is never lost.
 *
 * Loader options and address/credentials conventions mirror
 * src/server/grpc-client.ts (the authority for CRM gRPC clients), with one
 * deliberate deviation: every call carries a bounded deadline. The intake
 * route is public-facing and must fail fast into its Redis fallback rather
 * than hang on a stalled or unreachable endpoint; the internal, staff
 * triggered LedgerClient has no equivalent time pressure.
 */

import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load proto file
const PROTO_PATH = path.resolve(__dirname, '../../proto/marketing_service.proto')

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
})

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any
const MarketingServiceDefinition = protoDescriptor.billie.marketing.MarketingService

/** Bound every call so a stalled endpoint can't hang the public intake route. */
const DEADLINE_MS = 5000

// =============================================================================
// Types
// =============================================================================

export interface ConsentCapture {
  granted: boolean
  channels: string[]
  method: string
}

export interface UpsertContactInput {
  idempotencyKey: string
  firstName?: string
  email?: string
  mobile?: string
  city?: string
  postcode?: string
  source?: string
  utmJson?: string
  platforms?: string[]
  channelPreference?: string
  referredByCode?: string
  waitlist?: boolean
  consent?: ConsentCapture
  actor?: string
}

export interface UpsertContactResult {
  contactId: string
  eventId: string
  created: boolean
  idempotentReplay: boolean
}

export interface UpdateContactInput {
  idempotencyKey: string
  contactId: string
  firstName?: string
  email?: string
  mobile?: string
  city?: string
  postcode?: string
  channelPreference?: string
  attributesJson?: string
  actor?: string
}

export interface SetConsentInput {
  idempotencyKey: string
  contactId: string
  granted: boolean
  channels: string[]
  method: string
  evidence?: string
  actor?: string
}

export interface LogInteractionInput {
  idempotencyKey: string
  contactId: string
  kind: string
  channel?: string
  direction?: string
  subject?: string
  body?: string
  sourceSystem?: string
  occurredAt?: string
  metadataJson?: string
  actor?: string
}

export interface EraseContactInput {
  idempotencyKey: string
  contactId: string
  actor?: string
}

export interface CommandResult {
  contactId: string
  eventId: string
  idempotentReplay: boolean
}

export interface SubmitFeedbackInput {
  idempotencyKey: string
  contactId: string
  customerId?: string
  type: string
  severity?: string
  text: string
  productArea?: string
  actor?: string
}

export interface SubmitFeedbackResult {
  feedbackId: string
  eventId: string
  idempotentReplay: boolean
}

export interface CreateBatchInput {
  idempotencyKey: string
  name: string
  criteriaJson?: string
  actor?: string
}

export interface CreateBatchResult {
  batchId: string
  eventId: string
  idempotentReplay: boolean
}

export interface AssignBatchInput {
  idempotencyKey: string
  batchId: string
  contactIds: string[]
  actor?: string
}

export interface AssignBatchResult {
  batchId: string
  assignedCount: number
  eventId: string
  idempotentReplay: boolean
}

export interface TriggerBatchInvitationsInput {
  idempotencyKey: string
  batchId: string
  actor?: string
}

export interface TriggerBatchInvitationsResult {
  batchId: string
  invitedCount: number
  skippedUnconsented: number
  idempotentReplay: boolean
}

export interface SetFeedbackStatusInput {
  idempotencyKey: string
  feedbackId: string
  status: string
  /** What was done with the feedback — carried on feedback.status.changed.v1. */
  note?: string
  actor?: string
}

export interface SetFeedbackStatusResult {
  feedbackId: string
  eventId: string
  status: string
  idempotentReplay: boolean
}

// =============================================================================
// Client Class
// =============================================================================

export class MarketingClient {
  private client: any

  constructor(serviceUrl?: string) {
    const url = serviceUrl || process.env.MARKETING_GRPC_ADDRESS || 'localhost:50054'
    // Use insecure credentials for Fly.io internal addresses (already WireGuard-encrypted)
    // and localhost (local dev). Require TLS for any other address.
    const isInternalOrLocal =
      /\.internal(:\d+)?$/.test(url) || url.startsWith('localhost') || url.startsWith('127.')
    const creds = isInternalOrLocal
      ? grpc.credentials.createInsecure()
      : grpc.credentials.createSsl()
    this.client = new MarketingServiceDefinition(url, creds)
  }

  // Helper to promisify gRPC calls with a bounded deadline.
  private promisify<TRequest, TResponse>(
    method: (
      req: TRequest,
      options: grpc.CallOptions,
      callback: (err: any, res: TResponse) => void,
    ) => void,
  ): (req: TRequest) => Promise<TResponse> {
    return (request: TRequest) =>
      new Promise((resolve, reject) => {
        const deadline = new Date(Date.now() + DEADLINE_MS)
        method.call(this.client, request, { deadline }, (err: any, response: TResponse) => {
          if (err) {
            reject(err)
          } else {
            resolve(response)
          }
        })
      })
  }

  async upsertContact(request: UpsertContactInput): Promise<UpsertContactResult> {
    return this.promisify<UpsertContactInput, UpsertContactResult>(this.client.upsertContact)(
      request,
    )
  }

  async updateContact(request: UpdateContactInput): Promise<CommandResult> {
    return this.promisify<UpdateContactInput, CommandResult>(this.client.updateContact)(request)
  }

  async setConsent(request: SetConsentInput): Promise<CommandResult> {
    return this.promisify<SetConsentInput, CommandResult>(this.client.setConsent)(request)
  }

  async logInteraction(request: LogInteractionInput): Promise<CommandResult> {
    return this.promisify<LogInteractionInput, CommandResult>(this.client.logInteraction)(request)
  }

  async eraseContact(request: EraseContactInput): Promise<CommandResult> {
    return this.promisify<EraseContactInput, CommandResult>(this.client.eraseContact)(request)
  }

  async submitFeedback(request: SubmitFeedbackInput): Promise<SubmitFeedbackResult> {
    return this.promisify<SubmitFeedbackInput, SubmitFeedbackResult>(this.client.submitFeedback)(
      request,
    )
  }

  async createBatch(request: CreateBatchInput): Promise<CreateBatchResult> {
    return this.promisify<CreateBatchInput, CreateBatchResult>(this.client.createBatch)(request)
  }

  async assignBatch(request: AssignBatchInput): Promise<AssignBatchResult> {
    return this.promisify<AssignBatchInput, AssignBatchResult>(this.client.assignBatch)(request)
  }

  async triggerBatchInvitations(
    request: TriggerBatchInvitationsInput,
  ): Promise<TriggerBatchInvitationsResult> {
    return this.promisify<TriggerBatchInvitationsInput, TriggerBatchInvitationsResult>(
      this.client.triggerBatchInvitations,
    )(request)
  }

  async setFeedbackStatus(request: SetFeedbackStatusInput): Promise<SetFeedbackStatusResult> {
    return this.promisify<SetFeedbackStatusInput, SetFeedbackStatusResult>(
      this.client.setFeedbackStatus,
    )(request)
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let marketingClient: MarketingClient | null = null

export function getMarketingClient(): MarketingClient {
  if (!marketingClient) {
    marketingClient = new MarketingClient()
  }
  return marketingClient
}

// =============================================================================
// Convenience Functions (module-level, matching the CRM's client call sites)
// =============================================================================

export async function upsertContact(request: UpsertContactInput): Promise<UpsertContactResult> {
  return getMarketingClient().upsertContact(request)
}

export async function updateContact(request: UpdateContactInput): Promise<CommandResult> {
  return getMarketingClient().updateContact(request)
}

export async function setConsent(request: SetConsentInput): Promise<CommandResult> {
  return getMarketingClient().setConsent(request)
}

export async function logInteraction(request: LogInteractionInput): Promise<CommandResult> {
  return getMarketingClient().logInteraction(request)
}

export async function eraseContact(request: EraseContactInput): Promise<CommandResult> {
  return getMarketingClient().eraseContact(request)
}

export async function submitFeedback(request: SubmitFeedbackInput): Promise<SubmitFeedbackResult> {
  return getMarketingClient().submitFeedback(request)
}

export async function createBatch(request: CreateBatchInput): Promise<CreateBatchResult> {
  return getMarketingClient().createBatch(request)
}

export async function assignBatch(request: AssignBatchInput): Promise<AssignBatchResult> {
  return getMarketingClient().assignBatch(request)
}

export async function triggerBatchInvitations(
  request: TriggerBatchInvitationsInput,
): Promise<TriggerBatchInvitationsResult> {
  return getMarketingClient().triggerBatchInvitations(request)
}

export async function setFeedbackStatus(
  request: SetFeedbackStatusInput,
): Promise<SetFeedbackStatusResult> {
  return getMarketingClient().setFeedbackStatus(request)
}
