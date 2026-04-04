/**
 * Ensures MongoDB indexes exist for the conversations collection.
 *
 * Indexes support the conversation monitoring view queries:
 * - Compound: { status, decisionStatus, updatedAt } — main grid filter
 * - { customerIdString, updatedAt } — customer conversation lookup
 *
 * Note: { applicationNumber } index is managed by Payload (index: true on the field) — do not
 * create it here or MongoDB will throw IndexOptionsConflict (code 85) due to name mismatch.
 *
 * Story 1.3: Conversations Collection Schema & Indexes (NFR19)
 *
 * Usage: call ensureConversationIndexes() once at app startup or
 * from the first request to /api/conversations.
 */

import { getPayload } from 'payload'
import configPromise from '@payload-config'

let indexesEnsured = false

export async function ensureConversationIndexes(): Promise<void> {
  if (indexesEnsured) return

  try {
    const payload = await getPayload({ config: configPromise })
    // Access the underlying MongoDB collection via the mongoose adapter
    const db = (payload.db as any).connection?.db
    if (!db) return

    const collection = db.collection('conversations')

    await Promise.all([
      // Main monitoring grid filter: status + decisionStatus + updatedAt (desc)
      collection.createIndex(
        { status: 1, decisionStatus: 1, updatedAt: -1 },
        { background: true, name: 'conversations_monitor_grid' },
      ),
      // Customer conversation lookup
      collection.createIndex(
        { customerIdString: 1, updatedAt: -1 },
        { background: true, name: 'conversations_by_customer' },
      ),
    ])

    indexesEnsured = true
  } catch (err) {
    // Non-fatal: indexes are for performance, not correctness
    console.warn('[ensureConversationIndexes] Failed to create indexes:', err)
  }
}
