/**
 * Each person's pinned reports (`report-preferences`), read and written for
 * the signed-in user only.
 */
import type { Payload } from 'payload'
import { REPORT_SLUG_RE } from '@/lib/schemas/reports'

export const MAX_PINS = 20

/** Slugs from a request body: report-shaped and unique. Null for anything else. */
export function parsePins(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 200) return null
  const pins = value.filter((v): v is string => typeof v === 'string' && REPORT_SLUG_RE.test(v))
  if (pins.length !== value.length) return null
  return [...new Set(pins)]
}

export async function readPins(payload: Payload, userId: string): Promise<string[]> {
  const found = await payload.find({
    collection: 'report-preferences',
    where: { user: { equals: userId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return parsePins(found.docs[0]?.pinned) ?? []
}

async function updatePins(payload: Payload, userId: string, pins: string[]): Promise<boolean> {
  const result = await payload.update({
    collection: 'report-preferences',
    where: { user: { equals: userId } },
    data: { pinned: pins },
    overrideAccess: true,
  })
  return result.docs.length > 0
}

/** Save a person's pins, creating their row the first time. */
export async function writePins(payload: Payload, userId: string, pins: string[]): Promise<void> {
  if (await updatePins(payload, userId, pins)) return
  try {
    await payload.create({
      collection: 'report-preferences',
      data: { user: userId, pinned: pins },
      overrideAccess: true,
    })
  } catch (error) {
    // Two first saves raced and the other created the row (Payload's unique
    // check or the database index refused this one): update it instead.
    if (!(await updatePins(payload, userId, pins))) throw error
  }
}
