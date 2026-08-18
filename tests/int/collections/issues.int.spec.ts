import { describe, it, expect, beforeAll } from 'vitest'
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'
import type { IssueDiagnostics } from '@/lib/schemas/issues'
import type { User } from '@/payload-types'

let payload: Payload

const users: Record<string, User> = {}

/** Minimal payload that satisfies `issueDiagnosticsSchema`. */
function makeDiagnostics(overrides: Partial<IssueDiagnostics> = {}): IssueDiagnostics {
  return {
    context: {
      url: 'https://crm.test.local/admin/servicing',
      route: '/admin/servicing',
      buildSha: null,
      buildTime: null,
      reporter: { id: 1, email: 'reporter@billie.loans', role: 'readonly' },
      timeOnPageSec: 12,
      timezone: 'Australia/Sydney',
      capturedAt: '2026-08-18T00:00:00.000Z',
    },
    device: {
      userAgent: 'vitest',
      platform: 'darwin',
      viewport: { w: 1440, h: 900 },
      screen: { w: 1440, h: 900 },
      dpr: 2,
      online: true,
      connection: null,
    },
    interactions: [],
    routes: [],
    apiCalls: [],
    errors: [],
    failedActions: [],
    ...overrides,
  } as IssueDiagnostics
}

async function ensureUser(role: User['role'], email: string): Promise<User> {
  const existing = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    overrideAccess: true,
    limit: 1,
  })
  if (existing.docs[0]) return existing.docs[0] as User
  return (await payload.create({
    collection: 'users',
    data: {
      email,
      password: 'Test1234!',
      role,
      firstName: 'Issue',
      lastName: role,
    },
    overrideAccess: true,
  })) as User
}

beforeAll(async () => {
  payload = await getPayload({ config })
  for (const role of ['admin', 'operations', 'readonly', 'service', 'marketing'] as const) {
    users[role] = await ensureUser(role, `issues-${role}@billie.loans`)
  }
})

describe('issues collection', () => {
  describe('access control', () => {
    it('allows a readonly user to create a report', async () => {
      const created = await payload.create({
        collection: 'issues',
        data: { description: 'Readonly can report', diagnostics: makeDiagnostics() },
        user: users.readonly,
        overrideAccess: false,
      })
      expect(created.id).toBeDefined()
    })

    it('allows a marketing user to create a report', async () => {
      const created = await payload.create({
        collection: 'issues',
        data: { description: 'Marketing can report', diagnostics: makeDiagnostics() },
        user: users.marketing,
        overrideAccess: false,
      })
      expect(created.id).toBeDefined()
    })

    it('denies create for a service user', async () => {
      await expect(
        payload.create({
          collection: 'issues',
          data: { description: 'Service cannot report', diagnostics: makeDiagnostics() },
          user: users.service,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
    })

    it('denies read/list for a non-admin (operations) user', async () => {
      await expect(
        payload.find({
          collection: 'issues',
          user: users.operations,
          overrideAccess: false,
        }),
      ).rejects.toThrow(/not allowed to perform this action/)
    })

    it('allows read/list for an admin user', async () => {
      const created = await payload.create({
        collection: 'issues',
        data: { description: 'Admin readable', diagnostics: makeDiagnostics() },
        user: users.readonly,
        overrideAccess: false,
      })
      const res = await payload.find({
        collection: 'issues',
        where: { id: { equals: created.id } },
        user: users.admin,
        overrideAccess: false,
      })
      expect(res.docs).toHaveLength(1)
      expect(res.docs[0].id).toBe(created.id)
    })
  })

  describe('create hooks', () => {
    it('stamps reportedBy, forces status open, and strips resolution fields', async () => {
      const created = await payload.create({
        collection: 'issues',
        data: {
          description: 'Client tries to pre-resolve',
          diagnostics: makeDiagnostics(),
          status: 'resolved',
          resolvedAt: '2020-01-01T00:00:00.000Z',
          resolvedBy: users.admin.id,
          resolutionNote: 'client supplied',
          reportedBy: users.admin.id,
        } as never,
        user: users.readonly,
        overrideAccess: false,
      })

      const doc = await payload.findByID({
        collection: 'issues',
        id: created.id,
        depth: 0,
        overrideAccess: true,
      })

      expect(doc.status).toBe('open')
      expect(doc.reportedBy).toBe(users.readonly.id)
      expect(doc.resolvedAt ?? null).toBeNull()
      expect(doc.resolvedBy ?? null).toBeNull()
      expect(doc.resolutionNote ?? null).toBeNull()
    })

    it('derives the title from the first line of the description', async () => {
      const created = await payload.create({
        collection: 'issues',
        data: {
          description: 'Repayment modal froze\nThen the page went blank',
          diagnostics: makeDiagnostics(),
          title: 'client supplied title',
        } as never,
        user: users.readonly,
        overrideAccess: false,
      })
      expect(created.title).toBe('Repayment modal froze')
    })

    it('caps the derived title at 80 characters', async () => {
      const longLine = 'x'.repeat(200)
      const created = await payload.create({
        collection: 'issues',
        data: { description: longLine, diagnostics: makeDiagnostics() },
        user: users.readonly,
        overrideAccess: false,
      })
      expect(created.title).toHaveLength(80)
      expect(created.title).toBe('x'.repeat(80))
    })
  })

  describe('update hooks', () => {
    async function createOpenIssue(description = 'Update fixture') {
      return payload.create({
        collection: 'issues',
        data: { description, diagnostics: makeDiagnostics() },
        user: users.readonly,
        overrideAccess: false,
      })
    }

    it('ignores description edits, applying only status + resolutionNote', async () => {
      const issue = await createOpenIssue('Original description')
      const updated = await payload.update({
        collection: 'issues',
        id: issue.id,
        data: {
          description: 'Tampered description',
          triggerReason: 'server-error',
          resolutionNote: 'Triaged',
        } as never,
        user: users.admin,
        overrideAccess: false,
      })
      expect(updated.description).toBe('Original description')
      expect(updated.triggerReason ?? null).toBeNull()
      expect(updated.resolutionNote).toBe('Triaged')
    })

    it('stamps resolvedAt and resolvedBy when resolving', async () => {
      const issue = await createOpenIssue('Resolve me')
      const resolved = await payload.update({
        collection: 'issues',
        id: issue.id,
        data: { status: 'resolved', resolutionNote: 'Fixed in prod' },
        depth: 0,
        user: users.admin,
        overrideAccess: false,
      })
      expect(resolved.status).toBe('resolved')
      expect(resolved.resolvedAt).toBeTruthy()
      expect(resolved.resolvedBy).toBe(users.admin.id)
      expect(resolved.resolutionNote).toBe('Fixed in prod')
    })

    it('clears resolution stamps but keeps the note on reopen', async () => {
      const issue = await createOpenIssue('Reopen me')
      await payload.update({
        collection: 'issues',
        id: issue.id,
        data: { status: 'resolved', resolutionNote: 'Closed too early' },
        user: users.admin,
        overrideAccess: false,
      })
      const reopened = await payload.update({
        collection: 'issues',
        id: issue.id,
        data: { status: 'open' },
        depth: 0,
        user: users.admin,
        overrideAccess: false,
      })
      expect(reopened.status).toBe('open')
      expect(reopened.resolvedAt ?? null).toBeNull()
      expect(reopened.resolvedBy ?? null).toBeNull()
      expect(reopened.resolutionNote).toBe('Closed too early')
    })

    it('denies update for a non-admin user', async () => {
      const issue = await createOpenIssue('Non-admin cannot triage')
      await expect(
        payload.update({
          collection: 'issues',
          id: issue.id,
          data: { status: 'resolved' },
          user: users.operations,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
    })
  })

  describe('diagnostics validation', () => {
    it('rejects an oversize interactions array', async () => {
      const interactions = Array.from({ length: 11 }, (_, i) => ({
        at: '2026-08-18T00:00:00.000Z',
        type: 'click' as const,
        target: `button-${i}`,
        label: null,
      }))
      await expect(
        payload.create({
          collection: 'issues',
          data: {
            description: 'Too many interactions',
            diagnostics: makeDiagnostics({ interactions }),
          },
          user: users.readonly,
          overrideAccess: false,
        }),
      ).rejects.toThrow(/Invalid diagnostics payload/)
    })

    it('rejects a malformed event shape', async () => {
      await expect(
        payload.create({
          collection: 'issues',
          data: {
            description: 'Bad error event',
            diagnostics: makeDiagnostics({
              errors: [{ at: '2026-08-18T00:00:00.000Z', source: 'not-a-source' }],
            } as never),
          },
          user: users.readonly,
          overrideAccess: false,
        }),
      ).rejects.toThrow(/Invalid diagnostics payload/)
    })

    it('rejects a diagnostics payload over the byte ceiling', async () => {
      const huge = makeDiagnostics({
        errors: Array.from({ length: 30 }, () => ({
          at: '2026-08-18T00:00:00.000Z',
          source: 'window.onerror' as const,
          message: 'm'.repeat(500),
          stack: 's'.repeat(2000),
        })),
      })
      await expect(
        payload.create({
          collection: 'issues',
          data: { description: 'Oversize payload', diagnostics: huge },
          user: users.readonly,
          overrideAccess: false,
        }),
      ).rejects.toThrow(/Invalid diagnostics payload/)
    })
  })
})
