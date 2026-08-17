/**
 * Shared plumbing for every CRM gRPC client (ledger, collections,
 * notification-dispatcher, marketing).
 *
 * Three things lived in four hand-copied variants before this module existed:
 *
 *  1. `protoLoader.loadSync` options — identical everywhere, but nothing
 *     enforced that.
 *  2. The insecure-vs-TLS address predicate — four variants that had drifted:
 *     only the collections and notification clients carried the `.platform`
 *     clause, so pointing the ledger at a plaintext `.platform` host would
 *     have attempted TLS and failed. {@link isPlaintextAddress} is the
 *     superset of all four.
 *  3. `promisify` — none of the clients except marketing set a deadline, so a
 *     hung ledger could pin a Next.js worker forever on a money route.
 *     {@link promisifyGrpcCall} always sets one.
 *
 * Deadlines are classified, not uniform. See {@link RpcKind}: reads fail fast,
 * writes get a long leash (a money write whose outcome is ambiguous is worse
 * than a slow one — the routes carry client idempotency keys, so a retry after
 * DEADLINE_EXCEEDED replays the same key rather than double-posting), and
 * batch/analytical RPCs (period close preview, portfolio ECL recalculation,
 * exports) get longer still because they legitimately run for minutes.
 */

import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// =============================================================================
// Proto loading
// =============================================================================

/** Loader options shared by every CRM gRPC client. Changing these changes the wire contract. */
export const PROTO_LOADER_OPTIONS: protoLoader.Options = {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
}

/**
 * Load a `.proto` from the repo's top-level `proto/` directory and return the
 * generated service constructor.
 *
 * @param protoFileName - file name inside `proto/`, e.g. `accounting_ledger.proto`
 * @param servicePath - dotted path to the service, e.g. `billie.ledger.v1.AccountingLedgerService`
 */
export function loadProtoService(protoFileName: string, servicePath: string): any {
  const protoPath = path.resolve(__dirname, '../../proto', protoFileName)
  const packageDefinition = protoLoader.loadSync(protoPath, PROTO_LOADER_OPTIONS)
  const descriptor = grpc.loadPackageDefinition(packageDefinition) as any

  let node: any = descriptor
  for (const segment of servicePath.split('.')) {
    node = node?.[segment]
    if (!node) {
      throw new Error(`gRPC service "${servicePath}" not found in proto/${protoFileName}`)
    }
  }
  return node
}

// =============================================================================
// Credentials
// =============================================================================

/** Fly.io private networking — WireGuard-encrypted already, no TLS terminator. */
const INTERNAL_HOST_RE = /\.internal(:\d+)?$/
/** Platform service discovery names like `collections-service.platform:50053` — no TLS available. */
const PLATFORM_HOST_RE = /\.platform(:\d+)?$/

function parseBooleanEnv(raw: string | undefined): boolean | null {
  if (raw === undefined) return null
  const value = raw.trim().toLowerCase()
  if (value === '') return null
  if (['1', 'true', 'yes', 'on', 'require'].includes(value)) return true
  if (['0', 'false', 'no', 'off', 'insecure', 'disable'].includes(value)) return false
  return null
}

/**
 * Does this address speak plaintext gRPC?
 *
 * Superset of the four predicates this replaces:
 *  - `localhost[:port]`      → plaintext (local dev)
 *  - `127.x.x.x[:port]`      → plaintext (local dev)
 *  - `*.internal[:port]`     → plaintext (Fly.io private network, already encrypted)
 *  - `*.platform[:port]`     → plaintext (platform service discovery, no TLS listener)
 *  - anything else           → TLS
 *
 * An explicit flag wins over the address heuristic in both directions:
 * `tlsFlag` truthy forces TLS, falsy forces plaintext, unset/unparseable falls
 * back to the address regexes.
 */
export function isPlaintextAddress(url: string, tlsFlag?: string): boolean {
  const explicit = parseBooleanEnv(tlsFlag)
  if (explicit !== null) return !explicit

  return (
    url.startsWith('localhost') ||
    url.startsWith('127.') ||
    INTERNAL_HOST_RE.test(url) ||
    PLATFORM_HOST_RE.test(url)
  )
}

/**
 * Channel credentials for an address.
 *
 * @param url - the target address, e.g. `ledger.platform:50051`
 * @param tlsEnvVar - name of an optional per-service override env var
 *   (e.g. `LEDGER_GRPC_TLS`). `true`/`1` forces TLS, `false`/`0` forces
 *   plaintext, unset falls back to {@link isPlaintextAddress}.
 */
export function createGrpcCredentials(url: string, tlsEnvVar?: string): grpc.ChannelCredentials {
  const flag = tlsEnvVar ? process.env[tlsEnvVar] : undefined
  return isPlaintextAddress(url, flag)
    ? grpc.credentials.createInsecure()
    : grpc.credentials.createSsl()
}

// =============================================================================
// Deadlines
// =============================================================================

/**
 * How aggressively a call is bounded.
 *
 *  - `read`  — idempotent query. Fail fast; a stalled read must not hold a worker.
 *  - `write` — state-changing command. Long leash: cross-repo finding XR-8 warns
 *    against short deadlines on the ledger's commit sequence (DisburseLoan /
 *    WriteOff), so the goal here is bounding "forever", not making writes twitchy.
 *  - `batch` — long-running analytical/batch RPC (period close, portfolio ECL
 *    recalculation, exports) that legitimately runs for minutes.
 */
export type RpcKind = 'read' | 'write' | 'batch'

const DEFAULT_READ_DEADLINE_MS = 10_000
const DEFAULT_WRITE_DEADLINE_MS = 45_000
const DEFAULT_BATCH_DEADLINE_MS = 300_000

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

/**
 * Deadline in ms for a call kind. Read lazily from the environment so tests
 * (and env reloads) can change it between calls.
 *
 * Overrides: `GRPC_READ_DEADLINE_MS`, `GRPC_WRITE_DEADLINE_MS`,
 * `GRPC_BATCH_DEADLINE_MS`.
 */
export function getDeadlineMs(kind: RpcKind): number {
  switch (kind) {
    case 'write':
      return readPositiveInt(process.env.GRPC_WRITE_DEADLINE_MS, DEFAULT_WRITE_DEADLINE_MS)
    case 'batch':
      return readPositiveInt(process.env.GRPC_BATCH_DEADLINE_MS, DEFAULT_BATCH_DEADLINE_MS)
    case 'read':
    default:
      return readPositiveInt(process.env.GRPC_READ_DEADLINE_MS, DEFAULT_READ_DEADLINE_MS)
  }
}

/** A generated unary stub method, called with an explicit `CallOptions` argument. */
export type UnaryMethodWithOptions<TRequest, TResponse> = (
  req: TRequest,
  options: grpc.CallOptions,
  callback: (err: any, res: TResponse) => void,
) => void

/**
 * Promisify a unary gRPC stub method with a bounded deadline.
 *
 * The rejection value is the raw gRPC `ServiceError` — numeric `code`,
 * `details`, `message` — unchanged, because `handleApiError` and the
 * collections error helpers branch on it.
 *
 * A blown deadline rejects with code 4 (DEADLINE_EXCEEDED).
 *
 * @param client - the stub instance (`this` for the call)
 * @param method - the stub method, e.g. `client.getBalance`
 * @param kind - deadline class, see {@link RpcKind}
 * @param deadlineMsOverride - fixed deadline in ms, bypassing the env config
 */
export function promisifyGrpcCall<TRequest, TResponse>(
  client: unknown,
  method: UnaryMethodWithOptions<TRequest, TResponse>,
  kind: RpcKind = 'read',
  deadlineMsOverride?: number,
): (req: TRequest) => Promise<TResponse> {
  return (request: TRequest) =>
    new Promise<TResponse>((resolve, reject) => {
      const ms = deadlineMsOverride ?? getDeadlineMs(kind)
      const deadline = new Date(Date.now() + ms)
      method.call(client, request, { deadline }, (err: any, response: TResponse) => {
        if (err) reject(err)
        else resolve(response)
      })
    })
}
