import type { ApiCallEvent, ErrorEvent, InteractionEvent, RouteEvent } from '@/lib/schemas/issues'
import { createRingBuffer } from './ring-buffer'
import {
  ISSUE_API_CALLS_KEY,
  ISSUE_ERRORS_KEY,
  ISSUE_INTERACTIONS_KEY,
  ISSUE_ROUTES_KEY,
  MAX_API_CALLS,
  MAX_ERRORS,
  MAX_INTERACTIONS,
  MAX_ROUTES,
} from './constants'

/** The four shared buffers — trackers write, collectDiagnostics reads. */
export const interactionsBuffer = createRingBuffer<InteractionEvent>(
  ISSUE_INTERACTIONS_KEY,
  MAX_INTERACTIONS,
)
export const routesBuffer = createRingBuffer<RouteEvent>(ISSUE_ROUTES_KEY, MAX_ROUTES)
export const apiCallsBuffer = createRingBuffer<ApiCallEvent>(ISSUE_API_CALLS_KEY, MAX_API_CALLS)
export const errorsBuffer = createRingBuffer<ErrorEvent>(ISSUE_ERRORS_KEY, MAX_ERRORS)
