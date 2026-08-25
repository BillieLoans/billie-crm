import type { Payload } from 'payload'

/** Known system actors (BTB-295 etc.) mapped to a staff-friendly label. */
const SYSTEM_ACTOR_LABELS: Record<string, string> = {
  fraudRiskAgent: 'Fraud risk agent',
}

/** Title-case a camelCase/identifier suffix, e.g. "someNewAgent" -> "Some new agent". */
function titleCaseFallback(suffix: string): string {
  const spaced = suffix
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * Resolve a namespaced actor id (as stored on records like `killRecord.actor`)
 * to a human display name for staff-facing UI.
 *
 * - "user:<id>"   -> "<firstName> <lastName>" || email || the raw input
 * - "system:<x>"  -> a friendly label for known agents, else a title-cased
 *                    fallback of the suffix
 * - null/undefined/blank/non-string -> null
 * - any other unrecognised format -> the input unchanged
 *
 * Never throws for any input — a non-string/blank actor short-circuits before
 * any string method runs, and any lookup failure (including "not found")
 * falls back to the raw actor id, so this can never block the caller (e.g.
 * the conversation detail response).
 */
export async function resolveActorDisplayName(
  payload: Payload,
  actor: string | null | undefined,
): Promise<string | null> {
  // Normalize: anything that isn't a non-blank string (missing, wrong type from
  // malformed/legacy data, or whitespace-only) resolves to "no name" rather than
  // reaching string methods below — this is what makes "never throws" true for
  // any input, not just the well-typed ones.
  if (typeof actor !== 'string' || actor.trim() === '') return null

  if (actor.startsWith('user:')) {
    const id = actor.slice('user:'.length)
    try {
      const user = await payload.findByID({
        collection: 'users',
        id,
        depth: 0,
      })
      if (!user) return actor

      const fullName = [user.firstName, user.lastName]
        .filter((part): part is string => Boolean(part))
        .join(' ')
        .trim()

      return fullName || user.email || actor
    } catch {
      return actor
    }
  }

  if (actor.startsWith('system:')) {
    const suffix = actor.slice('system:'.length)
    return SYSTEM_ACTOR_LABELS[suffix] ?? titleCaseFallback(suffix)
  }

  return actor
}
