/**
 * OR-clause builder for the conversations monitoring-grid search
 * (GET /api/conversations). Matches the term against conversation-level
 * fields — customerIdString, applicationNumber, and the flat
 * statementAccountHolders text written by the event processor from
 * statement_retrieval_complete — plus any customer IDs already resolved
 * from the term (name/email/phone via customerSearchOrClauses).
 */

import type { Where } from 'payload'

export function conversationSearchOrClauses(term: string, matchedCustomerIds: string[]): Where[] {
  const orClauses: Where[] = [
    { customerIdString: { like: term } },
    { applicationNumber: { like: term } },
    { statementAccountHolders: { like: term } },
  ]
  if (matchedCustomerIds.length > 0) {
    orClauses.push({ customerIdString: { in: matchedCustomerIds } })
  }
  return orClauses
}
