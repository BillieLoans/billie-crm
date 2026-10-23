/**
 * A person's report subscriptions: list, create, pause and delete, for the
 * signed-in user only. Creating one checks the person can run the report
 * and that its saved settings bind; the deliveries job checks access again
 * every time it sends.
 */
import type { Payload } from 'payload'
import { bindParameters } from '@/lib/schemas/reports'
import { sameJson } from '@/lib/reports/diff'
import { formatValue, resolveColumns } from '@/lib/reports/columns'
import { dateRangeParameters, sydneyToday } from '@/lib/reports/periods'
import {
  DEFAULT_RANGE,
  MAX_SUBSCRIPTIONS_PER_USER,
  SUBSCRIPTION_RANGES,
  deliveryParameters,
  describeAlert,
  rangeLabel,
  type SubscriptionRequest,
} from '@/lib/reports/subscriptions'
import { isReportAuthor, listReports, type ReportSummary } from './run-report'
import { storedAlert, type SubscriptionDoc } from './deliveries'
import { slackConfigured } from './slack'

export interface SubscriptionView {
  id: string
  kind: 'digest' | 'alert'
  slug: string | null
  title: string
  frequency: string | null
  range: string | null
  rangeLabel: string | null
  channel: 'email' | 'slack'
  parameters: Record<string, unknown>
  /** "Decline rate above 30.0%", for an alert. */
  alert: string | null
  /** The alert's value at the last check, formatted. */
  lastValue: string | null
  alertActive: boolean
  paused: boolean
  lastSentAt: string | null
  lastCheckedAt: string | null
  lastError: string | null
}

export class SubscriptionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message)
    this.name = 'SubscriptionError'
  }
}

type StoredSubscription = SubscriptionDoc & {
  lastSentAt?: string | null
  lastCheckedAt?: string | null
  lastError?: string | null
}

async function ownDocs(payload: Payload, userId: string): Promise<StoredSubscription[]> {
  const found = await payload.find({
    collection: 'report-subscriptions',
    where: { user: { equals: userId } },
    sort: '-createdAt',
    limit: 200,
    depth: 0,
    overrideAccess: true,
  })
  return found.docs as unknown as StoredSubscription[]
}

function toView(sub: StoredSubscription, report: ReportSummary | undefined): SubscriptionView {
  const alert = sub.kind === 'alert' ? storedAlert(sub) : null
  const views = alert
    ? resolveColumns([{ name: alert.column, kind: 'number' }], report?.columns ?? [])
    : []
  const lastValue = sub.alert?.lastValue
  return {
    id: String(sub.id),
    kind: sub.kind,
    slug: report?.slug ?? null,
    title: report?.title ?? 'A report you can no longer open',
    frequency: sub.kind === 'digest' ? (sub.frequency ?? 'weekly') : null,
    range: sub.range ?? null,
    rangeLabel: rangeLabel(sub.range),
    channel: sub.channel === 'slack' ? 'slack' : 'email',
    parameters:
      sub.parameters && typeof sub.parameters === 'object' && !Array.isArray(sub.parameters)
        ? (sub.parameters as Record<string, unknown>)
        : {},
    alert: alert ? describeAlert(alert, views) : null,
    lastValue:
      alert && typeof lastValue === 'number'
        ? formatValue(lastValue, views[0]?.format ?? 'number')
        : null,
    alertActive: sub.alert?.active === true,
    paused: sub.paused === true,
    lastSentAt: sub.lastSentAt ?? null,
    lastCheckedAt: sub.lastCheckedAt ?? null,
    lastError: sub.lastError ?? null,
  }
}

export async function listSubscriptions(
  payload: Payload,
  user: { id: string | number },
): Promise<SubscriptionView[]> {
  const [docs, reports] = await Promise.all([
    ownDocs(payload, String(user.id)),
    listReports(payload, user),
  ])
  const byId = new Map(reports.filter((r) => r.published).map((r) => [r.id, r]))
  return docs.map((sub) => toView(sub, sub.report ? byId.get(String(sub.report)) : undefined))
}

export async function createSubscription(
  payload: Payload,
  user: { id: string | number },
  request: SubscriptionRequest,
): Promise<SubscriptionView> {
  const report = (await listReports(payload, user)).find(
    (r) => r.published && r.slug === request.slug,
  )
  if (!report) {
    throw new SubscriptionError(404, 'NOT_FOUND', 'There is no published report at this link.')
  }
  if (request.channel === 'slack' && !(isReportAuthor(user) && slackConfigured())) {
    throw new SubscriptionError(
      400,
      'NO_SLACK',
      'Only report authors can send reports to Slack, and only once Slack is set up.',
    )
  }
  const own = await ownDocs(payload, String(user.id))
  if (own.length >= MAX_SUBSCRIPTIONS_PER_USER) {
    throw new SubscriptionError(
      400,
      'TOO_MANY',
      `You can have up to ${MAX_SUBSCRIPTIONS_PER_USER} report emails and alerts. Remove one first.`,
    )
  }

  const range = dateRangeParameters(report.parameters)
  let rangeKey: string | null = null
  if (range) {
    rangeKey =
      request.range ?? (request.kind === 'digest' ? DEFAULT_RANGE[request.frequency] : 'last-7')
    if (!(SUBSCRIPTION_RANGES as readonly string[]).includes(rangeKey)) {
      throw new SubscriptionError(400, 'BAD_RANGE', 'Choose a period from the list.')
    }
  }
  // Keep the declared parameters only, and not the period (the preset sets it).
  const declared = new Set(report.parameters.map((p) => p.name))
  if (range) {
    declared.delete(range.from.name)
    declared.delete(range.to.name)
  }
  const parameters = Object.fromEntries(
    Object.entries(request.parameters).filter(([name]) => declared.has(name)),
  )
  const bound = bindParameters(
    report.parameters,
    deliveryParameters(report.parameters, parameters, rangeKey, sydneyToday()),
  )
  if (!bound.ok) {
    throw new SubscriptionError(
      400,
      'INVALID_PARAMETERS',
      'Fill in the report’s settings before subscribing.',
      bound.errors,
    )
  }

  const duplicate =
    request.kind === 'digest' &&
    own.some(
      (s) =>
        String(s.report) === report.id &&
        s.kind === 'digest' &&
        s.frequency === request.frequency &&
        (s.range ?? null) === rangeKey &&
        (s.channel ?? 'email') === request.channel &&
        // jsonb does not keep key order.
        sameJson(s.parameters ?? {}, parameters),
    )
  if (duplicate) {
    throw new SubscriptionError(409, 'ALREADY_SUBSCRIBED', 'You already get this report then.')
  }

  const doc = await payload.create({
    collection: 'report-subscriptions',
    data: {
      user: user.id,
      report: report.id,
      kind: request.kind,
      frequency: request.kind === 'digest' ? request.frequency : null,
      range: rangeKey,
      parameters,
      channel: request.channel,
      ...(request.kind === 'alert'
        ? {
            alert: {
              column: request.alert.column,
              row: request.alert.row ?? null,
              value: request.alert.value ?? null,
              operator: request.alert.operator,
              threshold: request.alert.threshold,
              active: false,
            },
          }
        : {}),
      paused: false,
    } as never,
    overrideAccess: true,
  })
  return toView(doc as unknown as StoredSubscription, report)
}

async function ownDoc(
  payload: Payload,
  user: { id: string | number },
  id: string,
): Promise<StoredSubscription> {
  const doc = (await payload
    .findByID({ collection: 'report-subscriptions', id, depth: 0, overrideAccess: true })
    .catch(() => null)) as StoredSubscription | null
  if (!doc || String(doc.user) !== String(user.id)) {
    throw new SubscriptionError(404, 'NOT_FOUND', 'There is no such report email or alert.')
  }
  return doc
}

export async function setPaused(
  payload: Payload,
  user: { id: string | number },
  id: string,
  paused: boolean,
): Promise<void> {
  await ownDoc(payload, user, id)
  await payload.update({
    collection: 'report-subscriptions',
    id,
    data: { paused } as never,
    overrideAccess: true,
  })
}

export async function deleteSubscription(
  payload: Payload,
  user: { id: string | number },
  id: string,
): Promise<void> {
  await ownDoc(payload, user, id)
  await payload.delete({ collection: 'report-subscriptions', id, overrideAccess: true })
}
