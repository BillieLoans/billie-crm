import { describe, it, expect } from 'vitest'
import {
  apiCallEventSchema,
  errorEventSchema,
  interactionEventSchema,
  issueDiagnosticsSchema,
  routeEventSchema,
  type IssueDiagnostics,
} from '@/lib/schemas/issues'

// =============================================================================
// Fixtures
// =============================================================================

const interaction = () => ({
  at: '2026-08-18T00:00:00.000Z',
  type: 'click' as const,
  target: 'button#submit.btn',
  label: 'Record repayment',
})

const route = () => ({
  at: '2026-08-18T00:00:00.000Z',
  from: '/admin/dashboard',
  to: '/admin/servicing/LOAN-1',
})

const apiCall = () => ({
  at: '2026-08-18T00:00:00.000Z',
  method: 'POST',
  path: '/api/ledger/repayment',
  status: 200,
  ok: true,
  durationMs: 143,
  error: null,
})

const errorEvent = () => ({
  at: '2026-08-18T00:00:00.000Z',
  source: 'window.onerror' as const,
  message: 'Cannot read properties of undefined',
  stack: 'Error: boom\n  at x',
})

const validDiagnostics = (): IssueDiagnostics => ({
  context: {
    url: '/admin/servicing/LOAN-1',
    route: '/admin/servicing/LOAN-1',
    buildSha: 'abc1234',
    buildTime: '2026-08-18T00:00:00.000Z',
    reporter: { id: 'user-1', email: 'ash.crick@example.com', role: 'operations' },
    timeOnPageSec: 42,
    timezone: 'Australia/Sydney',
    capturedAt: '2026-08-18T00:00:00.000Z',
  },
  device: {
    userAgent: 'Mozilla/5.0 (Macintosh)',
    platform: 'MacIntel',
    viewport: { w: 1440, h: 900 },
    screen: { w: 2560, h: 1440 },
    dpr: 2,
    online: true,
    connection: { effectiveType: '4g', downlink: 10, rtt: 50 },
  },
  interactions: [interaction()],
  routes: [route()],
  apiCalls: [apiCall()],
  errors: [errorEvent()],
  failedActions: [{ id: 'fa-1', type: 'repayment', retryCount: 2 }],
})

// =============================================================================
// Event schemas
// =============================================================================

describe('interactionEventSchema', () => {
  it('accepts a valid click event', () => {
    expect(interactionEventSchema.safeParse(interaction()).success).toBe(true)
  })

  it.each(['click', 'change', 'submit'])('accepts type "%s"', (type) => {
    expect(interactionEventSchema.safeParse({ ...interaction(), type }).success).toBe(true)
  })

  it('rejects an unknown type', () => {
    expect(interactionEventSchema.safeParse({ ...interaction(), type: 'keydown' }).success).toBe(
      false,
    )
  })

  it('accepts a null label', () => {
    expect(interactionEventSchema.safeParse({ ...interaction(), label: null }).success).toBe(true)
  })

  it('rejects a missing label key (nullable, not optional)', () => {
    const { label: _label, ...rest } = interaction()
    expect(interactionEventSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects a target longer than 120 chars', () => {
    expect(
      interactionEventSchema.safeParse({ ...interaction(), target: 'x'.repeat(121) }).success,
    ).toBe(false)
  })

  it('accepts a target of exactly 120 chars', () => {
    expect(
      interactionEventSchema.safeParse({ ...interaction(), target: 'x'.repeat(120) }).success,
    ).toBe(true)
  })

  it('rejects a label longer than 60 chars', () => {
    expect(
      interactionEventSchema.safeParse({ ...interaction(), label: 'x'.repeat(61) }).success,
    ).toBe(false)
  })

  it('rejects a non-string target', () => {
    expect(interactionEventSchema.safeParse({ ...interaction(), target: 42 }).success).toBe(false)
  })
})

describe('routeEventSchema', () => {
  it('accepts a valid route event', () => {
    expect(routeEventSchema.safeParse(route()).success).toBe(true)
  })

  it('accepts a null "from" (first navigation)', () => {
    expect(routeEventSchema.safeParse({ ...route(), from: null }).success).toBe(true)
  })

  it('rejects a null "to"', () => {
    expect(routeEventSchema.safeParse({ ...route(), to: null }).success).toBe(false)
  })

  it('rejects a "to" longer than 200 chars', () => {
    expect(routeEventSchema.safeParse({ ...route(), to: 'x'.repeat(201) }).success).toBe(false)
  })
})

describe('apiCallEventSchema', () => {
  it('accepts a valid api call event', () => {
    expect(apiCallEventSchema.safeParse(apiCall()).success).toBe(true)
  })

  it('accepts a null status with an error string (failed call)', () => {
    expect(
      apiCallEventSchema.safeParse({
        ...apiCall(),
        status: null,
        ok: false,
        error: 'TypeError',
      }).success,
    ).toBe(true)
  })

  it('rejects a method longer than 10 chars', () => {
    expect(apiCallEventSchema.safeParse({ ...apiCall(), method: 'x'.repeat(11) }).success).toBe(
      false,
    )
  })

  it('rejects a path longer than 200 chars', () => {
    expect(apiCallEventSchema.safeParse({ ...apiCall(), path: 'x'.repeat(201) }).success).toBe(
      false,
    )
  })

  it('rejects an error longer than 200 chars', () => {
    expect(apiCallEventSchema.safeParse({ ...apiCall(), error: 'x'.repeat(201) }).success).toBe(
      false,
    )
  })

  it('rejects a non-boolean ok', () => {
    expect(apiCallEventSchema.safeParse({ ...apiCall(), ok: 'true' }).success).toBe(false)
  })

  it('rejects a non-numeric durationMs', () => {
    expect(apiCallEventSchema.safeParse({ ...apiCall(), durationMs: '143' }).success).toBe(false)
  })

  it('rejects a string status', () => {
    expect(apiCallEventSchema.safeParse({ ...apiCall(), status: '200' }).success).toBe(false)
  })
})

describe('errorEventSchema', () => {
  it.each(['window.onerror', 'unhandledrejection', 'react-boundary', 'fetch-failed'])(
    'accepts source "%s"',
    (source) => {
      expect(errorEventSchema.safeParse({ ...errorEvent(), source }).success).toBe(true)
    },
  )

  it('rejects an unknown source', () => {
    expect(errorEventSchema.safeParse({ ...errorEvent(), source: 'console' }).success).toBe(false)
  })

  it('accepts a null stack', () => {
    expect(errorEventSchema.safeParse({ ...errorEvent(), stack: null }).success).toBe(true)
  })

  it('rejects a message longer than 500 chars', () => {
    expect(errorEventSchema.safeParse({ ...errorEvent(), message: 'x'.repeat(501) }).success).toBe(
      false,
    )
  })

  it('rejects a stack longer than 2000 chars', () => {
    expect(errorEventSchema.safeParse({ ...errorEvent(), stack: 'x'.repeat(2001) }).success).toBe(
      false,
    )
  })
})

// =============================================================================
// Diagnostics envelope
// =============================================================================

describe('issueDiagnosticsSchema', () => {
  it('parses a valid full payload', () => {
    const result = issueDiagnosticsSchema.safeParse(validDiagnostics())

    expect(result.success).toBe(true)
    expect(result.success && result.data.context.route).toBe('/admin/servicing/LOAN-1')
  })

  it('parses a minimal payload with empty buffers and a null connection', () => {
    const payload = validDiagnostics()
    payload.interactions = []
    payload.routes = []
    payload.apiCalls = []
    payload.errors = []
    payload.failedActions = []
    payload.device.connection = null
    payload.device.platform = null
    payload.context.buildSha = null
    payload.context.buildTime = null

    expect(issueDiagnosticsSchema.safeParse(payload).success).toBe(true)
  })

  it('accepts a numeric reporter id', () => {
    const payload = validDiagnostics()
    payload.context.reporter.id = 17

    expect(issueDiagnosticsSchema.safeParse(payload).success).toBe(true)
  })

  describe('array caps', () => {
    it('accepts exactly 10 interactions but rejects 11', () => {
      const at10 = { ...validDiagnostics(), interactions: Array.from({ length: 10 }, interaction) }
      const at11 = { ...validDiagnostics(), interactions: Array.from({ length: 11 }, interaction) }

      expect(issueDiagnosticsSchema.safeParse(at10).success).toBe(true)
      expect(issueDiagnosticsSchema.safeParse(at11).success).toBe(false)
    })

    it('accepts exactly 10 routes but rejects 11', () => {
      expect(
        issueDiagnosticsSchema.safeParse({
          ...validDiagnostics(),
          routes: Array.from({ length: 10 }, route),
        }).success,
      ).toBe(true)
      expect(
        issueDiagnosticsSchema.safeParse({
          ...validDiagnostics(),
          routes: Array.from({ length: 11 }, route),
        }).success,
      ).toBe(false)
    })

    it('accepts exactly 15 apiCalls but rejects 16', () => {
      expect(
        issueDiagnosticsSchema.safeParse({
          ...validDiagnostics(),
          apiCalls: Array.from({ length: 15 }, apiCall),
        }).success,
      ).toBe(true)
      expect(
        issueDiagnosticsSchema.safeParse({
          ...validDiagnostics(),
          apiCalls: Array.from({ length: 16 }, apiCall),
        }).success,
      ).toBe(false)
    })

    it('accepts exactly 30 errors but rejects 31', () => {
      expect(
        issueDiagnosticsSchema.safeParse({
          ...validDiagnostics(),
          errors: Array.from({ length: 30 }, errorEvent),
        }).success,
      ).toBe(true)
      expect(
        issueDiagnosticsSchema.safeParse({
          ...validDiagnostics(),
          errors: Array.from({ length: 31 }, errorEvent),
        }).success,
      ).toBe(false)
    })

    it('accepts exactly 20 failedActions but rejects 21', () => {
      const action = () => ({ id: 'fa', type: 'repayment' })
      expect(
        issueDiagnosticsSchema.safeParse({
          ...validDiagnostics(),
          failedActions: Array.from({ length: 20 }, action),
        }).success,
      ).toBe(true)
      expect(
        issueDiagnosticsSchema.safeParse({
          ...validDiagnostics(),
          failedActions: Array.from({ length: 21 }, action),
        }).success,
      ).toBe(false)
    })
  })

  describe('size ceiling', () => {
    it('rejects a payload whose serialised form exceeds 65536 bytes', () => {
      const payload = validDiagnostics()
      // 30 errors × (500 + 2000) chars comfortably clears the ceiling while
      // every individual field stays within its own cap.
      payload.errors = Array.from({ length: 30 }, () => ({
        at: '2026-08-18T00:00:00.000Z',
        source: 'window.onerror' as const,
        message: 'm'.repeat(500),
        stack: 's'.repeat(2000),
      }))

      expect(JSON.stringify(payload).length).toBeGreaterThan(65536)

      const result = issueDiagnosticsSchema.safeParse(payload)

      expect(result.success).toBe(false)
      expect(result.success === false && result.error.issues.map((i) => i.message)).toContain(
        'diagnostics payload too large',
      )
    })

    it('accepts a large-but-under-ceiling payload', () => {
      const payload = validDiagnostics()
      payload.errors = Array.from({ length: 10 }, () => ({
        at: '2026-08-18T00:00:00.000Z',
        source: 'window.onerror' as const,
        message: 'm'.repeat(500),
        stack: 's'.repeat(2000),
      }))

      expect(JSON.stringify(payload).length).toBeLessThan(65536)
      expect(issueDiagnosticsSchema.safeParse(payload).success).toBe(true)
    })
  })

  describe('malformed shapes', () => {
    it('rejects a malformed event inside an otherwise valid array', () => {
      const payload = {
        ...validDiagnostics(),
        interactions: [interaction(), { at: '2026-08-18T00:00:00.000Z', type: 'click' }],
      }

      expect(issueDiagnosticsSchema.safeParse(payload).success).toBe(false)
    })

    it('rejects an event array that is not an array', () => {
      expect(
        issueDiagnosticsSchema.safeParse({ ...validDiagnostics(), apiCalls: interaction() }).success,
      ).toBe(false)
    })

    it('rejects a missing top-level section', () => {
      const { device: _device, ...rest } = validDiagnostics()
      expect(issueDiagnosticsSchema.safeParse(rest).success).toBe(false)
    })

    it('rejects a missing reporter block', () => {
      const payload = validDiagnostics()
      delete (payload.context as Partial<typeof payload.context>).reporter

      expect(issueDiagnosticsSchema.safeParse(payload).success).toBe(false)
    })

    it('rejects a viewport that is not a {w,h} pair', () => {
      const payload = validDiagnostics()
      ;(payload.device as unknown as { viewport: unknown }).viewport = { w: 100 }

      expect(issueDiagnosticsSchema.safeParse(payload).success).toBe(false)
    })

    it('rejects non-object inputs', () => {
      expect(issueDiagnosticsSchema.safeParse(null).success).toBe(false)
      expect(issueDiagnosticsSchema.safeParse('nope').success).toBe(false)
      expect(issueDiagnosticsSchema.safeParse([]).success).toBe(false)
    })
  })

  describe('string caps in the envelope', () => {
    it('rejects a context.url longer than 500 chars', () => {
      const payload = validDiagnostics()
      payload.context.url = 'x'.repeat(501)

      expect(issueDiagnosticsSchema.safeParse(payload).success).toBe(false)
    })

    it('rejects a context.route longer than 200 chars', () => {
      const payload = validDiagnostics()
      payload.context.route = 'x'.repeat(201)

      expect(issueDiagnosticsSchema.safeParse(payload).success).toBe(false)
    })

    it('rejects a buildSha longer than 60 chars', () => {
      const payload = validDiagnostics()
      payload.context.buildSha = 'x'.repeat(61)

      expect(issueDiagnosticsSchema.safeParse(payload).success).toBe(false)
    })

    it('rejects a reporter email longer than 200 chars', () => {
      const payload = validDiagnostics()
      payload.context.reporter.email = 'x'.repeat(201)

      expect(issueDiagnosticsSchema.safeParse(payload).success).toBe(false)
    })

    it('rejects a role longer than 30 chars', () => {
      const payload = validDiagnostics()
      payload.context.reporter.role = 'x'.repeat(31)

      expect(issueDiagnosticsSchema.safeParse(payload).success).toBe(false)
    })

    it('rejects a timezone longer than 60 chars', () => {
      const payload = validDiagnostics()
      payload.context.timezone = 'x'.repeat(61)

      expect(issueDiagnosticsSchema.safeParse(payload).success).toBe(false)
    })

    it('rejects a userAgent longer than 400 chars', () => {
      const payload = validDiagnostics()
      payload.device.userAgent = 'x'.repeat(401)

      expect(issueDiagnosticsSchema.safeParse(payload).success).toBe(false)
    })

    it('rejects a connection.effectiveType longer than 20 chars', () => {
      const payload = validDiagnostics()
      payload.device.connection = { effectiveType: 'x'.repeat(21), downlink: 1, rtt: 1 }

      expect(issueDiagnosticsSchema.safeParse(payload).success).toBe(false)
    })

    it('accepts strings sitting exactly on their cap', () => {
      const payload = validDiagnostics()
      payload.context.url = 'x'.repeat(500)
      payload.context.route = 'x'.repeat(200)
      payload.context.buildSha = 'x'.repeat(60)
      payload.context.reporter.role = 'x'.repeat(30)
      payload.device.userAgent = 'x'.repeat(400)

      expect(issueDiagnosticsSchema.safeParse(payload).success).toBe(true)
    })
  })
})
