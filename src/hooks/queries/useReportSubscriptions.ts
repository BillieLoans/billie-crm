'use client'

import { useQuery } from '@tanstack/react-query'
import type { SubscriptionView } from '@/server/reporting/subscriptions'

export type { SubscriptionView }

export const SUBSCRIPTIONS_KEY = ['reports', 'subscriptions'] as const

export interface SubscriptionsResponse {
  subscriptions: SubscriptionView[]
  /** Whether this person can send reports to the Slack channel. */
  slack: boolean
}

/** A refused change, with the server's message and any field errors. */
export class SubscriptionFailure extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message)
    this.name = 'SubscriptionFailure'
  }
}

/** A request to the subscriptions API; throws SubscriptionFailure when refused. */
export async function sendSubscriptionRequest<T>(
  url: string,
  method: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = (await res.json().catch(() => null)) as
    | (T & { error?: { code?: string; message?: string; fields?: Record<string, string> } })
    | null
  if (!res.ok) {
    throw new SubscriptionFailure(
      json?.error?.message ?? 'That could not be saved. Try again.',
      json?.error?.code ?? 'FAILED',
      json?.error?.fields,
    )
  }
  return json as T
}

/** The signed-in user's report emails and alerts. */
export function useReportSubscriptions(enabled = true) {
  return useQuery({
    queryKey: SUBSCRIPTIONS_KEY,
    queryFn: () =>
      sendSubscriptionRequest<SubscriptionsResponse>('/api/reports/subscriptions', 'GET'),
    enabled,
    staleTime: 30_000,
  })
}
