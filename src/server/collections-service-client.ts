/**
 * gRPC client for CollectionsService (the headless collections engine).
 *
 * Operator actions (FlagHardship, ResumeFromHardship, ApplyStopContact,
 * AdvanceToNextStep) are synchronous gRPC commands — the engine applies
 * the FSM transition, emits the `collection.case.*` event to ChatLedger,
 * and returns a verdict. The CRM never calls the superseded dispatcher
 * hardship RPCs for this flow.
 *
 * Economics reads (GetCaseEconomics / ListCaseEconomics) degrade
 * gracefully: until the cost-of-recovery engine (BTB-194) is deployed,
 * the provider returns `gate_result = NOT_APPLICABLE` and empty
 * economics rather than erroring — see proto/collections_service.proto.
 *
 * Mirrors the connection style of src/server/notification-dispatcher-client.ts —
 * insecure credentials for Fly.io internal addresses (already
 * WireGuard-encrypted) and localhost; TLS elsewhere.
 */

import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PROTO_PATH = path.resolve(__dirname, '../../proto/collections_service.proto')

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
})

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any
const CollectionsService = protoDescriptor.billie.collections.v1.CollectionsService

// =============================================================================
// Types
// =============================================================================

export interface CaseActionResponse {
  accountId: string
  newState: string
  emittedEventId: string
}

export type GateStatus = 'GATE_UNSPECIFIED' | 'PASS' | 'FAIL' | 'NOT_APPLICABLE'

export interface GateResult {
  status: GateStatus
  reason: string
}

export interface CostLedgerEntry {
  label: string
  amount: string
  category: 'production' | 'hard'
  recoverable: boolean
}

export interface NextStepPreview {
  rung: number
  channel: string
  template: string
  subject: string
  body: string
}

export interface CaseEconomics {
  accountId: string
  amountOwed: string
  costOfNextStep: string
  expectedNetRecovery: string
  gateResult: GateResult
  costLedger: CostLedgerEntry[]
  nextStepPreview: NextStepPreview | null
}

export interface ContactCapStatus {
  sent7d: number
  cap7d: number
  sentMonth: number
  capMonth: number
}

export interface ContactLogEntry {
  sentAt: string | null
  channel: string
  template: string
  outcome: string
}

export interface ContactLog {
  accountId: string
  entries: ContactLogEntry[]
  contactCapStatus: ContactCapStatus
}

export interface FlagHardshipOptions {
  accountId: string
  operatorId: string
  reason: string
  idempotencyKey: string
}

export interface ResumeFromHardshipOptions {
  accountId: string
  operatorId: string
  idempotencyKey: string
}

export interface ApplyStopContactOptions {
  accountId: string
  operatorId: string
  reason?: string
  idempotencyKey: string
}

export interface AdvanceToNextStepOptions {
  accountId: string
  operatorId: string
  idempotencyKey: string
}

// =============================================================================
// Timestamp conversion
// =============================================================================

interface ProtoTimestamp {
  seconds?: string | number
  nanos?: number
}

export function timestampToIso(ts: ProtoTimestamp | null | undefined): string | null {
  if (!ts) return null
  const seconds = typeof ts.seconds === 'string' ? parseInt(ts.seconds, 10) : (ts.seconds ?? 0)
  if (!seconds) return null
  const millis = Math.floor((ts.nanos ?? 0) / 1_000_000)
  return new Date(seconds * 1000 + millis).toISOString()
}

// =============================================================================
// Response mapping
// =============================================================================

export function decodeCaseActionResponse(raw: any): CaseActionResponse {
  return {
    accountId: raw?.accountId ?? '',
    newState: raw?.newState ?? '',
    emittedEventId: raw?.emittedEventId ?? '',
  }
}

const GATE_STATUSES: readonly GateStatus[] = ['GATE_UNSPECIFIED', 'PASS', 'FAIL', 'NOT_APPLICABLE']

function decodeGateResult(raw: any): GateResult {
  const status = raw?.status as GateStatus | undefined
  return {
    status: status && GATE_STATUSES.includes(status) ? status : 'GATE_UNSPECIFIED',
    reason: raw?.reason ?? '',
  }
}

function decodeCostLedgerEntry(raw: any): CostLedgerEntry {
  return {
    label: raw?.label ?? '',
    amount: raw?.amount ?? '',
    category: raw?.category === 'hard' ? 'hard' : 'production',
    recoverable: Boolean(raw?.recoverable),
  }
}

function decodeNextStepPreview(raw: any): NextStepPreview | null {
  if (!raw?.rung && !raw?.channel && !raw?.template) return null
  return {
    rung: raw?.rung ?? 0,
    channel: raw?.channel ?? '',
    template: raw?.template ?? '',
    subject: raw?.subject ?? '',
    body: raw?.body ?? '',
  }
}

export function decodeCaseEconomics(raw: any): CaseEconomics {
  return {
    accountId: raw?.accountId ?? '',
    amountOwed: raw?.amountOwed ?? '',
    costOfNextStep: raw?.costOfNextStep ?? '',
    expectedNetRecovery: raw?.expectedNetRecovery ?? '',
    gateResult: decodeGateResult(raw?.gateResult),
    costLedger: ((raw?.costLedger ?? []) as any[]).map(decodeCostLedgerEntry),
    nextStepPreview: decodeNextStepPreview(raw?.nextStepPreview),
  }
}

function decodeContactCapStatus(raw: any): ContactCapStatus {
  // NOTE: @grpc/proto-loader with keepCase:false does NOT camelCase an
  // underscore followed by a digit, so the wire object arrives as
  // `sent_7d` / `cap_7d` (not `sent7d` / `cap7d`) while `sent_month` /
  // `cap_month` DO camelCase normally to `sentMonth` / `capMonth`.
  return {
    sent7d: raw?.sent_7d ?? 0,
    cap7d: raw?.cap_7d ?? 0,
    sentMonth: raw?.sentMonth ?? 0,
    capMonth: raw?.capMonth ?? 0,
  }
}

function decodeContactLogEntry(raw: any): ContactLogEntry {
  return {
    sentAt: timestampToIso(raw?.sentAt),
    channel: raw?.channel ?? '',
    template: raw?.template ?? '',
    outcome: raw?.outcome ?? '',
  }
}

export function decodeContactLog(raw: any): ContactLog {
  return {
    accountId: raw?.accountId ?? '',
    entries: ((raw?.entries ?? []) as any[]).map(decodeContactLogEntry),
    contactCapStatus: decodeContactCapStatus(raw?.contactCapStatus),
  }
}

// =============================================================================
// Client
// =============================================================================

export class CollectionsServiceClient {
  private client: any

  constructor(serviceUrl?: string) {
    const url = serviceUrl || process.env.COLLECTIONS_SERVICE_GRPC_URL || 'localhost:50053'
    const isInternalOrLocal =
      /\.internal(:\d+)?$/.test(url) ||
      url.startsWith('localhost') ||
      url.startsWith('127.') ||
      // Plain hostname like 'collections-service.platform:50053' (no TLS available)
      /^[a-z0-9-]+\.platform(:\d+)?$/.test(url)
    const creds = isInternalOrLocal
      ? grpc.credentials.createInsecure()
      : grpc.credentials.createSsl()
    this.client = new CollectionsService(url, creds)
  }

  private promisify<TRequest, TResponse>(
    method: (req: TRequest, callback: (err: any, res: TResponse) => void) => void,
  ): (req: TRequest) => Promise<TResponse> {
    return (request: TRequest) =>
      new Promise((resolve, reject) => {
        method.call(this.client, request, (err: any, response: TResponse) => {
          if (err) reject(err)
          else resolve(response)
        })
      })
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  async flagHardship(options: FlagHardshipOptions): Promise<CaseActionResponse> {
    const response = await this.promisify<any, any>(this.client.flagHardship)({
      accountId: options.accountId,
      operatorId: options.operatorId,
      reason: options.reason,
      idempotencyKey: options.idempotencyKey,
    })
    return decodeCaseActionResponse(response)
  }

  async resumeFromHardship(options: ResumeFromHardshipOptions): Promise<CaseActionResponse> {
    const response = await this.promisify<any, any>(this.client.resumeFromHardship)({
      accountId: options.accountId,
      operatorId: options.operatorId,
      idempotencyKey: options.idempotencyKey,
    })
    return decodeCaseActionResponse(response)
  }

  async applyStopContact(options: ApplyStopContactOptions): Promise<CaseActionResponse> {
    const response = await this.promisify<any, any>(this.client.applyStopContact)({
      accountId: options.accountId,
      operatorId: options.operatorId,
      reason: options.reason ?? '',
      idempotencyKey: options.idempotencyKey,
    })
    return decodeCaseActionResponse(response)
  }

  async advanceToNextStep(options: AdvanceToNextStepOptions): Promise<CaseActionResponse> {
    const response = await this.promisify<any, any>(this.client.advanceToNextStep)({
      accountId: options.accountId,
      operatorId: options.operatorId,
      idempotencyKey: options.idempotencyKey,
    })
    return decodeCaseActionResponse(response)
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async getCaseEconomics(accountId: string): Promise<CaseEconomics> {
    const response = await this.promisify<{ accountId: string }, any>(
      this.client.getCaseEconomics,
    )({ accountId })
    return decodeCaseEconomics(response)
  }

  async listCaseEconomics(accountIds: string[]): Promise<CaseEconomics[]> {
    const response = await this.promisify<{ accountIds: string[] }, any>(
      this.client.listCaseEconomics,
    )({ accountIds })
    const items: any[] = response?.items ?? []
    return items.map(decodeCaseEconomics)
  }

  async getContactLog(accountId: string): Promise<ContactLog> {
    const response = await this.promisify<{ accountId: string }, any>(
      this.client.getContactLog,
    )({ accountId })
    return decodeContactLog(response)
  }
}

// =============================================================================
// Singleton
// =============================================================================

let collectionsServiceClient: CollectionsServiceClient | null = null

export function getCollectionsServiceClient(): CollectionsServiceClient {
  if (!collectionsServiceClient) collectionsServiceClient = new CollectionsServiceClient()
  return collectionsServiceClient
}

// =============================================================================
// Error helpers
// =============================================================================

export function isNotFound(err: unknown): boolean {
  return (
    !!err && typeof err === 'object' && (err as any).code === grpc.status.NOT_FOUND
  )
}

export function isFailedPrecondition(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    (err as any).code === grpc.status.FAILED_PRECONDITION
  )
}

export function isResourceExhausted(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    (err as any).code === grpc.status.RESOURCE_EXHAUSTED
  )
}
