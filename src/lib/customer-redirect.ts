/**
 * A customer id that is a former record (BTB-392): an identity link folded it
 * into `redirectTo`. Raised by the customer query; followed by the servicing
 * view. Lives outside the hook module so tests that mock the hook keep a
 * real class to check against.
 */

export interface CustomerRedirectResponse {
  redirectTo: string
  viaAlias: string
  mergedReason?: string | null
}

export class CustomerRedirectError extends Error {
  readonly redirectTo: string
  readonly viaAlias: string
  readonly mergedReason: string | null

  constructor(response: CustomerRedirectResponse) {
    super(`Customer ${response.viaAlias} was merged into ${response.redirectTo}`)
    this.name = 'CustomerRedirectError'
    this.redirectTo = response.redirectTo
    this.viaAlias = response.viaAlias
    this.mergedReason = response.mergedReason ?? null
  }
}

export function isCustomerRedirectResponse(data: unknown): data is CustomerRedirectResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as CustomerRedirectResponse).redirectTo === 'string' &&
    (data as CustomerRedirectResponse).redirectTo.length > 0
  )
}
