/**
 * Client-safe types and labels for notification suppression.
 *
 * This module is intentionally free of any Node-only imports (no @grpc/grpc-js,
 * no `fs`, etc.) so it can be imported from both server routes and client
 * components. The gRPC dispatcher client re-uses these constants too.
 */

export type SuppressionMode = 'all' | 'non_essential' | 'marketing_only'

export const SUPPRESSION_MODES: readonly SuppressionMode[] = [
  'all',
  'non_essential',
  'marketing_only',
] as const

export const SUPPRESSION_MODE_LABELS: Record<SuppressionMode, string> = {
  all: 'All notifications paused',
  non_essential: 'Paused — non-essential',
  marketing_only: 'Marketing paused',
}

export const SUPPRESSION_MODE_DESCRIPTIONS: Record<SuppressionMode, string> = {
  all: 'Blocks every send including auth (password reset). For disputed accounts or legal holds.',
  non_essential:
    'Blocks servicing + marketing; allows auth (password reset). Recommended for hardship / complaint handling.',
  marketing_only:
    'Blocks marketing only; servicing and auth still flow. A tighter version of the marketing opt-out.',
}
