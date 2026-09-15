import { useQuery } from '@tanstack/react-query'
import type { ConversationDetail } from '@/lib/schemas/conversations'
import type { IdentityAttempt } from '@/lib/identityAttempts'

export interface CustomerIdentityVerification {
  conversationId: string
  applicationNumber: string | null
  assessedAt: string | null
  /** Verbatim `identityRisk_assessment` payload (incl. `lab_verification`). */
  identity: Record<string, unknown>
  /** Every LAB verify call for that application (spec 2026-09-15). */
  attempts: IdentityAttempt[]
  report: NonNullable<ConversationDetail['identityVerificationReport']>
}

export class IdentityVerificationNotFoundError extends Error {
  constructor() {
    super('No identity verification for this customer')
    this.name = 'IdentityVerificationNotFoundError'
  }
}

async function fetchIdentityVerification(
  customerId: string,
): Promise<CustomerIdentityVerification> {
  const res = await fetch(`/api/customer/${encodeURIComponent(customerId)}/identity-verification`)
  if (res.status === 404) throw new IdentityVerificationNotFoundError()
  if (!res.ok) throw new Error('Failed to fetch identity verification')
  return (await res.json()) as CustomerIdentityVerification
}

/**
 * Latest identity risk assessment for a customer (servicing view drawer).
 * Fetched lazily — pass `enabled: false` until the drawer opens.
 */
export function useIdentityVerification(customerId: string, enabled = true) {
  return useQuery({
    queryKey: ['customer', customerId, 'identity-verification'],
    queryFn: () => fetchIdentityVerification(customerId),
    enabled: enabled && !!customerId,
    staleTime: 60_000,
    retry: (count, error) => !(error instanceof IdentityVerificationNotFoundError) && count < 2,
  })
}
