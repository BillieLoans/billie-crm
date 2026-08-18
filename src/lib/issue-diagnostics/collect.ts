import type { IssueDiagnostics } from '@/lib/schemas/issues'
import { issueDiagnosticsSchema } from '@/lib/schemas/issues'
import { useFailedActionsStore } from '@/stores/failed-actions'
import { apiCallsBuffer, errorsBuffer, interactionsBuffer, routesBuffer } from './buffers'
import { installErrorTracker } from './error-tracker'
import { installFetchTracker } from './fetch-tracker'
import { installInteractionTracker } from './interaction-tracker'
import { sanitizeUrl } from './sanitize'

/** Reporter identity passed in by the caller (Payload's `useAuth().user`) */
type ReporterUser = { id: string | number; email?: string | null; role?: string | null } | null

/** Max failed-action entries attached to a report */
const MAX_FAILED_ACTIONS_IN_REPORT = 20

let pageLoadedAt: number | null = null

/**
 * Install every client-side tracker and stamp the page-load mark.
 * Idempotent — each installer guards itself, and the mark is set once.
 */
export function installIssueTrackers(): void {
  if (typeof window === 'undefined') return

  if (pageLoadedAt === null) {
    pageLoadedAt = performance.now()
  }

  installInteractionTracker()
  installFetchTracker()
  installErrorTracker()
}

/**
 * Run an accessor, falling back if it throws.
 *
 * collectDiagnostics runs at the moment a user is already having a bad time —
 * it must never be the thing that throws, so every browser API read and every
 * store access goes through here.
 */
function safe<T>(fn: () => T, fallback: T): T {
  try {
    const value = fn()
    return value === undefined || value === null ? fallback : value
  } catch {
    return fallback
  }
}

/** Minimal, schema-valid payload used when assembly or validation fails */
function emptyDiagnostics(user: ReporterUser): IssueDiagnostics {
  return {
    context: {
      url: '',
      route: '',
      buildSha: null,
      buildTime: null,
      reporter: {
        id: user?.id ?? '',
        email: user?.email ?? '',
        role: user?.role ?? '',
      },
      timeOnPageSec: 0,
      timezone: '',
      capturedAt: new Date().toISOString(),
    },
    device: {
      userAgent: '',
      platform: null,
      viewport: { w: 0, h: 0 },
      screen: { w: 0, h: 0 },
      dpr: 1,
      online: true,
      connection: null,
    },
    interactions: [],
    routes: [],
    apiCalls: [],
    errors: [],
    failedActions: [],
  } as IssueDiagnostics
}

/** The parts of the assembled payload the shrink steps operate on */
type DiagnosticsCandidate = {
  interactions: unknown[]
  routes: unknown[]
  apiCalls: unknown[]
  errors: { stack: string | null }[]
  failedActions: unknown[]
}

/** Keep only the most recent half of a rolling list */
function halve<T>(items: T[]): T[] {
  return items.slice(Math.ceil(items.length / 2))
}

/** Stacks are the single bulkiest field in the payload — drop them first */
function dropStacks(candidate: DiagnosticsCandidate): DiagnosticsCandidate {
  return { ...candidate, errors: candidate.errors.map((entry) => ({ ...entry, stack: null })) }
}

/**
 * Ordered shrink transforms, tried in turn until one validates.
 *
 * Each step is strictly lossier than the one before it, so the report keeps as
 * much of the trail as the size cap allows instead of collapsing to nothing.
 */
const SHRINK_STEPS: Array<(candidate: DiagnosticsCandidate) => DiagnosticsCandidate> = [
  // 1. Full payload
  (candidate) => candidate,
  // 2. Without error stacks
  (candidate) => dropStacks(candidate),
  // 3. Without error stacks, and only the most recent half of each list
  (candidate) => {
    const stripped = dropStacks(candidate)
    return {
      ...stripped,
      interactions: halve(stripped.interactions),
      routes: halve(stripped.routes),
      apiCalls: halve(stripped.apiCalls),
      errors: halve(stripped.errors),
      failedActions: halve(stripped.failedActions),
    }
  },
  // 4. Context and device only
  (candidate) => ({
    ...candidate,
    interactions: [],
    routes: [],
    apiCalls: [],
    errors: [],
    failedActions: [],
  }),
]

/**
 * Assemble the diagnostics payload attached to an issue report.
 *
 * PRIVACY: everything here is metadata — sanitized URLs, element identity,
 * HTTP metadata, error text and device capabilities. No input values, no
 * request bodies, no customer PII.
 */
export function collectDiagnostics(user: ReporterUser): IssueDiagnostics {
  try {
    const nav = safe(() => navigator, undefined as unknown as Navigator)
    const connection = safe(
      () => (nav as unknown as { connection?: Record<string, unknown> })?.connection,
      undefined,
    )

    const href = safe(() => window.location.href, '')
    const pathname = safe(() => window.location.pathname, '')

    const failedActions = safe(
      () =>
        useFailedActionsStore
          .getState()
          .actions.slice(-MAX_FAILED_ACTIONS_IN_REPORT)
          .map((action) => ({
            id: action.id,
            type: action.type,
            accountId: action.accountId,
            errorMessage: action.errorMessage,
            timestamp: action.timestamp,
            retryCount: action.retryCount,
          })) as Record<string, unknown>[],
      [] as Record<string, unknown>[],
    )

    const candidate = {
      context: {
        url: safe(() => sanitizeUrl(href), '').slice(0, 500),
        route: safe(() => pathname, '').slice(0, 200),
        // Docker can bake this in as an empty string — treat any falsy value as absent.
        buildSha: safe(() => process.env.NEXT_PUBLIC_BUILD_SHA || null, null),
        buildTime: null,
        reporter: {
          id: user?.id ?? '',
          email: user?.email ?? '',
          role: user?.role ?? '',
        },
        timeOnPageSec: safe(
          () => Math.max(0, Math.round((performance.now() - (pageLoadedAt ?? 0)) / 1000)),
          0,
        ),
        timezone: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone, '').slice(0, 60),
        capturedAt: new Date().toISOString(),
      },
      device: {
        userAgent: safe(() => nav.userAgent, '').slice(0, 400),
        platform: safe(() => nav.platform ?? null, null),
        viewport: {
          w: safe(() => window.innerWidth, 0),
          h: safe(() => window.innerHeight, 0),
        },
        screen: {
          w: safe(() => window.screen.width, 0),
          h: safe(() => window.screen.height, 0),
        },
        dpr: safe(() => window.devicePixelRatio, 1),
        online: safe(() => nav.onLine, true),
        connection: connection
          ? {
              effectiveType: safe(
                () =>
                  typeof connection.effectiveType === 'string'
                    ? connection.effectiveType.slice(0, 20)
                    : null,
                null,
              ),
              downlink: safe(
                () => (typeof connection.downlink === 'number' ? connection.downlink : null),
                null,
              ),
              rtt: safe(() => (typeof connection.rtt === 'number' ? connection.rtt : null), null),
            }
          : null,
      },
      interactions: safe(() => interactionsBuffer.read(), []),
      routes: safe(() => routesBuffer.read(), []),
      apiCalls: safe(() => apiCallsBuffer.read(), []),
      errors: safe(() => errorsBuffer.read(), []),
      failedActions,
    }

    // Progressive degradation: the schema's serialised-size cap can reject an
    // otherwise-valid payload, so shed the bulkiest parts a step at a time
    // rather than throwing the whole report away.
    for (const shrink of SHRINK_STEPS) {
      const parsed = issueDiagnosticsSchema.safeParse(shrink(candidate))
      if (parsed.success) return parsed.data
    }

    return emptyDiagnostics(user)
  } catch {
    return emptyDiagnostics(user)
  }
}
