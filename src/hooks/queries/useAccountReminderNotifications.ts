'use client'

import { useQuery } from '@tanstack/react-query'
import { stringify } from 'qs-esm'
import type { NotificationData } from './useNotifications'

/**
 * Reminder notifications sent for one loan account, grouped by collections rung.
 *
 * Notifications are projected per customer, not per account, so the account is
 * recovered from the dispatcher's idempotency key, which the platform builds as
 *   pre-due:  predue:{accountId}:{instalment}:{ruleIndex}
 *   overdue:  overdue:{accountId}:{seriesStartDate}:{step}
 * and suffixes with `:fallback` when it re-sends on the other channel
 * (billie-platform-services notificationService/policy.py and
 * collectionsService/policy.py). Rung 0 is pre-due; rungs 1–5 are overdue steps.
 */

const MAX_REMINDERS = 100

export function reminderRungForKey(
  idempotencyKey: string | null | undefined,
  accountId: string,
): number | null {
  if (!idempotencyKey) return null
  const parts = idempotencyKey.split(':')
  if (parts[1] !== accountId) return null
  if (parts[0] === 'predue') return 0
  if (parts[0] === 'overdue') {
    const step = Number(parts[3])
    return Number.isInteger(step) && step > 0 ? step : null
  }
  return null
}

export function groupRemindersByRung(
  notifications: NotificationData[],
  accountId: string,
): Map<number, NotificationData[]> {
  const byRung = new Map<number, NotificationData[]>()
  for (const n of notifications) {
    const rung = reminderRungForKey(n.idempotencyKey, accountId)
    if (rung === null) continue
    const list = byRung.get(rung) ?? []
    list.push(n)
    byRung.set(rung, list)
  }
  return byRung
}

async function fetchAccountReminders(
  customerId: string,
  accountId: string,
): Promise<NotificationData[]> {
  const queryString = stringify(
    {
      where: {
        and: [
          { customerId: { equals: customerId } },
          { idempotencyKey: { contains: `:${accountId}:` } },
        ],
      },
      sort: '-eventAt',
      limit: MAX_REMINDERS,
      depth: 0,
    },
    { addQueryPrefix: true },
  )
  const res = await fetch(`/api/notifications${queryString}`, { credentials: 'include' })
  if (!res.ok) throw new Error('Failed to fetch reminder notifications')
  const data: { docs: NotificationData[] } = await res.json()
  // The `contains` filter is a substring match; keep only keys that really
  // belong to this account.
  return data.docs.filter((n) => reminderRungForKey(n.idempotencyKey, accountId) !== null)
}

export const accountRemindersQueryKey = (customerId: string, accountId: string) =>
  ['notifications', 'account-reminders', customerId, accountId] as const

export function useAccountReminderNotifications(customerId: string | null, accountId: string) {
  return useQuery({
    queryKey: accountRemindersQueryKey(customerId ?? '', accountId),
    queryFn: () => fetchAccountReminders(customerId as string, accountId),
    enabled: !!customerId && !!accountId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  })
}
