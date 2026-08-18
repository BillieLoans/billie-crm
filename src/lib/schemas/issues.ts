import { z } from 'zod'

/**
 * Diagnostics payload attached to an in-app problem report.
 *
 * Everything here is collected client-side from rolling buffers (see
 * `src/lib/issue-diagnostics/`). The caps below are the contract those buffers
 * trim to — they exist so a report stays small enough to store as JSON and so a
 * long-lived tab cannot accumulate an unbounded trail.
 *
 * Privacy: element identity only, never input values. URLs are sanitised before
 * they reach these schemas.
 */

// =============================================================================
// Event schemas
// =============================================================================

export const interactionEventSchema = z.object({
  at: z.string(),
  type: z.enum(['click', 'change', 'submit']),
  target: z.string().max(120),
  label: z.string().max(60).nullable(),
})
export type InteractionEvent = z.infer<typeof interactionEventSchema>

export const routeEventSchema = z.object({
  at: z.string(),
  from: z.string().nullable(),
  to: z.string().max(200),
})
export type RouteEvent = z.infer<typeof routeEventSchema>

export const apiCallEventSchema = z.object({
  at: z.string(),
  method: z.string().max(10),
  path: z.string().max(200),
  status: z.number().nullable(),
  ok: z.boolean(),
  durationMs: z.number(),
  error: z.string().max(200).nullable(),
})
export type ApiCallEvent = z.infer<typeof apiCallEventSchema>

export const errorEventSchema = z.object({
  at: z.string(),
  source: z.enum(['window.onerror', 'unhandledrejection', 'react-boundary', 'fetch-failed']),
  message: z.string().max(500),
  stack: z.string().max(2000).nullable(),
})
export type ErrorEvent = z.infer<typeof errorEventSchema>

// =============================================================================
// Diagnostics envelope
// =============================================================================

/** Hard ceiling on the serialised payload — keeps a single report row sane. */
const MAX_DIAGNOSTICS_BYTES = 65536

export const issueDiagnosticsSchema = z
  .object({
    context: z.object({
      url: z.string().max(500),
      route: z.string().max(200),
      buildSha: z.string().max(60).nullable(),
      buildTime: z.string().max(40).nullable(),
      reporter: z.object({
        id: z.union([z.string(), z.number()]),
        email: z.string().max(200),
        role: z.string().max(30),
      }),
      timeOnPageSec: z.number(),
      timezone: z.string().max(60),
      capturedAt: z.string(),
    }),
    device: z.object({
      userAgent: z.string().max(400),
      platform: z.string().max(60).nullable(),
      viewport: z.object({ w: z.number(), h: z.number() }),
      screen: z.object({ w: z.number(), h: z.number() }),
      dpr: z.number(),
      online: z.boolean(),
      connection: z
        .object({
          effectiveType: z.string().max(20).nullable(),
          downlink: z.number().nullable(),
          rtt: z.number().nullable(),
        })
        .nullable(),
    }),
    interactions: z.array(interactionEventSchema).max(10),
    routes: z.array(routeEventSchema).max(10),
    apiCalls: z.array(apiCallEventSchema).max(15),
    errors: z.array(errorEventSchema).max(30),
    failedActions: z.array(z.record(z.string(), z.unknown())).max(20),
  })
  .superRefine((value, ctx) => {
    if (JSON.stringify(value).length > MAX_DIAGNOSTICS_BYTES) {
      ctx.addIssue({
        code: 'custom',
        message: 'diagnostics payload too large',
      })
    }
  })
export type IssueDiagnostics = z.infer<typeof issueDiagnosticsSchema>
