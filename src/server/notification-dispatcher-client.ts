/**
 * gRPC client for NotificationDispatcherService.
 *
 * Two responsibilities:
 *  1. Fetch the rendered subject/body of a past notification (90-day window).
 *  2. Read / write per-customer notification suppression (kill switch).
 *
 * Mirrors the connection style of src/server/grpc-client.ts — insecure
 * credentials for Fly.io internal addresses (already WireGuard-encrypted)
 * and localhost; TLS elsewhere.
 */

import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import path from 'path'
import { fileURLToPath } from 'url'
import type { SuppressionMode } from '@/lib/notifications/suppression'

export type { SuppressionMode } from '@/lib/notifications/suppression'
export {
  SUPPRESSION_MODES,
  SUPPRESSION_MODE_LABELS,
  SUPPRESSION_MODE_DESCRIPTIONS,
} from '@/lib/notifications/suppression'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PROTO_PATH = path.resolve(__dirname, '../../proto/notification_dispatcher.proto')

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
})

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any
const NotificationDispatcherService =
  protoDescriptor.billie.notification_dispatcher.v1.NotificationDispatcherService

// =============================================================================
// Types
// =============================================================================

export type SuppressionModeWire =
  | 'SUPPRESSION_MODE_UNSPECIFIED'
  | 'SUPPRESSION_MODE_ALL'
  | 'SUPPRESSION_MODE_NON_ESSENTIAL'
  | 'SUPPRESSION_MODE_MARKETING_ONLY'

const MODE_TO_WIRE: Record<SuppressionMode, SuppressionModeWire> = {
  all: 'SUPPRESSION_MODE_ALL',
  non_essential: 'SUPPRESSION_MODE_NON_ESSENTIAL',
  marketing_only: 'SUPPRESSION_MODE_MARKETING_ONLY',
}

const WIRE_TO_MODE: Record<SuppressionModeWire, SuppressionMode | null> = {
  SUPPRESSION_MODE_UNSPECIFIED: null,
  SUPPRESSION_MODE_ALL: 'all',
  SUPPRESSION_MODE_NON_ESSENTIAL: 'non_essential',
  SUPPRESSION_MODE_MARKETING_ONLY: 'marketing_only',
}

export interface Suppression {
  customerId: string
  mode: SuppressionMode | null
  reason: string
  setBy: string
  setAt: string | null
  expiresAt: string | null
  sourceEventId: string
  activeNow: boolean
}

export interface NotificationBody {
  notificationId: string
  idempotencyKey: string
  channel: 'email' | 'sms' | string
  templateName: string
  templateContentHash: string
  templateGitSha: string
  subject: string
  body: string
  isHtml: boolean
  provider: string
  providerMessageId: string
  recipientHash: string
  customerId: string
  correlationId: string
  sentAt: string | null
  failedAt: string | null
  success: boolean
  errorType: string
  errorMessage: string
  tags: Record<string, string>
}

export interface GetNotificationOptions {
  notificationId: string
}

export interface SetSuppressionOptions {
  customerId: string
  mode: SuppressionMode
  reason: string
  setBy: string
  expiresAt?: string | null
  correlationId?: string
}

export interface ClearSuppressionOptions {
  customerId: string
  setBy: string
  correlationId?: string
}

// =============================================================================
// Errors
// =============================================================================

/**
 * Thrown when the dispatcher returns NOT_FOUND for either:
 *  - GetNotification (notification older than 90 days, or never existed)
 *  - GetSuppression  (no active suppression)
 *
 * Callers should branch on this to render the appropriate empty state.
 */
export class NotFoundError extends Error {
  constructor(public readonly resource: 'notification' | 'suppression', message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

// =============================================================================
// Timestamp conversion
// =============================================================================

interface ProtoTimestamp {
  seconds?: string | number
  nanos?: number
}

function timestampToIso(ts: ProtoTimestamp | null | undefined): string | null {
  if (!ts) return null
  const seconds = typeof ts.seconds === 'string' ? parseInt(ts.seconds, 10) : (ts.seconds ?? 0)
  if (!seconds) return null
  const millis = Math.floor((ts.nanos ?? 0) / 1_000_000)
  return new Date(seconds * 1000 + millis).toISOString()
}

function isoToTimestamp(iso: string | null | undefined): ProtoTimestamp | undefined {
  if (!iso) return undefined
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return undefined
  const seconds = Math.floor(ms / 1000)
  const nanos = (ms % 1000) * 1_000_000
  return { seconds: String(seconds), nanos }
}

function decodeSuppression(raw: any): Suppression {
  const wireMode = (raw?.mode ?? 'SUPPRESSION_MODE_UNSPECIFIED') as SuppressionModeWire
  return {
    customerId: raw?.customerId ?? '',
    mode: WIRE_TO_MODE[wireMode] ?? null,
    reason: raw?.reason ?? '',
    setBy: raw?.setBy ?? '',
    setAt: timestampToIso(raw?.setAt),
    expiresAt: timestampToIso(raw?.expiresAt),
    sourceEventId: raw?.sourceEventId ?? '',
    activeNow: Boolean(raw?.activeNow),
  }
}

// =============================================================================
// Client
// =============================================================================

export class NotificationDispatcherClient {
  private client: any

  constructor(serviceUrl?: string) {
    const url =
      serviceUrl ||
      process.env.NOTIFICATION_DISPATCHER_GRPC_URL ||
      'localhost:50052'
    const isInternalOrLocal =
      /\.internal(:\d+)?$/.test(url) ||
      url.startsWith('localhost') ||
      url.startsWith('127.') ||
      // Plain hostname like 'notification-dispatcher.platform:50052' (no TLS available)
      /^[a-z0-9-]+\.platform(:\d+)?$/.test(url)
    const creds = isInternalOrLocal
      ? grpc.credentials.createInsecure()
      : grpc.credentials.createSsl()
    this.client = new NotificationDispatcherService(url, creds)
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
  // Notification body
  // ---------------------------------------------------------------------------

  async getNotificationBody(options: GetNotificationOptions): Promise<NotificationBody> {
    try {
      const response: any = await this.promisify<{ notificationId: string }, any>(
        this.client.getNotification,
      )({ notificationId: options.notificationId })

      return {
        notificationId: response.notificationId ?? '',
        idempotencyKey: response.idempotencyKey ?? '',
        channel: response.channel ?? '',
        templateName: response.templateName ?? '',
        templateContentHash: response.templateContentHash ?? '',
        templateGitSha: response.templateGitSha ?? '',
        subject: response.subject ?? '',
        body: response.body ?? '',
        isHtml: Boolean(response.isHtml),
        provider: response.provider ?? '',
        providerMessageId: response.providerMessageId ?? '',
        recipientHash: response.recipientHash ?? '',
        customerId: response.customerId ?? '',
        correlationId: response.correlationId ?? '',
        sentAt: timestampToIso(response.sentAt),
        failedAt: timestampToIso(response.failedAt),
        success: Boolean(response.success),
        errorType: response.errorType ?? '',
        errorMessage: response.errorMessage ?? '',
        tags: (response.tags ?? {}) as Record<string, string>,
      }
    } catch (err) {
      if (isNotFound(err)) {
        throw new NotFoundError(
          'notification',
          'Notification body is not retrievable (older than 90 days or never existed).',
        )
      }
      throw err
    }
  }

  // ---------------------------------------------------------------------------
  // Suppression
  // ---------------------------------------------------------------------------

  /** Returns the current suppression for a customer, or null on NOT_FOUND. */
  async getSuppression(customerId: string): Promise<Suppression | null> {
    try {
      const response = await this.promisify<{ customerId: string }, any>(
        this.client.getSuppression,
      )({ customerId })
      return decodeSuppression(response)
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  async setSuppression(options: SetSuppressionOptions): Promise<Suppression> {
    const request: any = {
      customerId: options.customerId,
      mode: MODE_TO_WIRE[options.mode],
      reason: options.reason,
      setBy: options.setBy,
    }
    const expiresAt = isoToTimestamp(options.expiresAt ?? null)
    if (expiresAt) request.expiresAt = expiresAt
    if (options.correlationId) request.correlationId = options.correlationId

    const response = await this.promisify<any, any>(this.client.setSuppression)(request)
    return decodeSuppression(response)
  }

  async clearSuppression(
    options: ClearSuppressionOptions,
  ): Promise<{ customerId: string; cleared: boolean }> {
    const request: any = {
      customerId: options.customerId,
      setBy: options.setBy,
    }
    if (options.correlationId) request.correlationId = options.correlationId

    const response = await this.promisify<any, any>(this.client.clearSuppression)(request)
    return {
      customerId: response.customerId ?? options.customerId,
      cleared: Boolean(response.cleared),
    }
  }

  async listSuppressions(): Promise<Suppression[]> {
    const response = await this.promisify<Record<string, never>, any>(
      this.client.listSuppressions,
    )({})
    const items: any[] = response.suppressions ?? []
    return items.map(decodeSuppression)
  }
}

// =============================================================================
// Singleton
// =============================================================================

let dispatcherClient: NotificationDispatcherClient | null = null

export function getNotificationDispatcherClient(): NotificationDispatcherClient {
  if (!dispatcherClient) dispatcherClient = new NotificationDispatcherClient()
  return dispatcherClient
}

// =============================================================================
// Helpers
// =============================================================================

function isNotFound(err: any): boolean {
  return err && typeof err === 'object' && err.code === grpc.status.NOT_FOUND
}

