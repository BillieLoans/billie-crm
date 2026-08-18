import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { installFetchTracker } from '@/lib/issue-diagnostics/fetch-tracker'
import { apiCallsBuffer, errorsBuffer } from '@/lib/issue-diagnostics/buffers'
import {
  ISSUE_5XX_EVENT,
  ISSUE_API_CALLS_KEY,
  ISSUE_ERRORS_KEY,
  MAX_API_CALLS,
} from '@/lib/issue-diagnostics/constants'
import type { ApiCallEvent, ErrorEvent } from '@/lib/schemas/issues'

const ORIGIN = window.location.origin

const originalFetch = window.fetch

/** Install the tracker over a fresh (unpatched) mock and return the mock. */
function installOver(impl: (...args: unknown[]) => unknown) {
  const mock = vi.fn(impl)
  window.fetch = mock as unknown as typeof fetch
  installFetchTracker()
  return mock
}

const apiEntries = () => apiCallsBuffer.read() as ApiCallEvent[]
const errorEntries = () => errorsBuffer.read() as ErrorEvent[]

describe('installFetchTracker', () => {
  beforeEach(() => {
    localStorage.clear()
    window.fetch = originalFetch
  })

  afterEach(() => {
    window.fetch = originalFetch
    localStorage.clear()
    vi.restoreAllMocks()
  })

  describe('what gets logged', () => {
    it('logs a same-origin /api/* call with method, path, status, ok and duration', async () => {
      const mock = installOver(async () => new Response('{}', { status: 200 }))

      await window.fetch('/api/accounts/LOAN-1', { method: 'POST' })

      const entries = apiEntries()
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        method: 'POST',
        path: '/api/accounts/LOAN-1',
        status: 200,
        ok: true,
        error: null,
      })
      expect(typeof entries[0].durationMs).toBe('number')
      expect(entries[0].durationMs).toBeGreaterThanOrEqual(0)
      expect(new Date(entries[0].at).toString()).not.toBe('Invalid Date')
      expect(mock).toHaveBeenCalledTimes(1)
    })

    it('defaults the method to GET', async () => {
      installOver(async () => new Response('{}', { status: 200 }))

      await window.fetch('/api/dashboard')

      expect(apiEntries()[0].method).toBe('GET')
    })

    it('uppercases the method', async () => {
      installOver(async () => new Response('{}', { status: 200 }))

      await window.fetch('/api/x', { method: 'patch' })

      expect(apiEntries()[0].method).toBe('PATCH')
    })

    it('logs an absolute same-origin /api url', async () => {
      installOver(async () => new Response('{}', { status: 200 }))

      await window.fetch(`${ORIGIN}/api/issues`, { method: 'POST' })

      expect(apiEntries()[0].path).toBe('/api/issues')
    })

    it('logs a Request object input, taking its method', async () => {
      installOver(async () => new Response('{}', { status: 201 }))

      await window.fetch(new Request(`${ORIGIN}/api/issues`, { method: 'POST' }))

      expect(apiEntries()[0]).toMatchObject({ method: 'POST', path: '/api/issues', status: 201 })
    })

    it('logs a URL object input', async () => {
      installOver(async () => new Response('{}', { status: 200 }))

      await window.fetch(new URL(`${ORIGIN}/api/system-health`))

      expect(apiEntries()[0].path).toBe('/api/system-health')
    })

    it('records ok=false for a non-2xx response', async () => {
      installOver(async () => new Response('{}', { status: 404 }))

      await window.fetch('/api/missing')

      expect(apiEntries()[0]).toMatchObject({ status: 404, ok: false })
    })

    it('sanitizes sensitive query params out of the logged path', async () => {
      installOver(async () => new Response('{}', { status: 200 }))

      await window.fetch('/api/customers/search?q=jane+doe&token=abc123&page=2')

      const { path } = apiEntries()[0]
      expect(path).not.toContain('jane')
      expect(path).not.toContain('abc123')
      expect(path).toContain('page=2')
      expect(decodeURIComponent(path)).toContain('q=[redacted]')
    })

    it('honours the buffer cap', async () => {
      installOver(async () => new Response('{}', { status: 200 }))

      for (let i = 0; i < MAX_API_CALLS + 5; i++) {
        await window.fetch(`/api/x/${i}`)
      }

      expect(apiEntries()).toHaveLength(MAX_API_CALLS)
      expect(apiEntries()[MAX_API_CALLS - 1].path).toBe(`/api/x/${MAX_API_CALLS + 4}`)
    })
  })

  describe('what does NOT get logged', () => {
    it('ignores cross-origin calls', async () => {
      const mock = installOver(async () => new Response('{}', { status: 200 }))

      await window.fetch('https://s3.amazonaws.com/api/upload', { method: 'PUT' })

      expect(apiEntries()).toEqual([])
      expect(mock).toHaveBeenCalledTimes(1)
    })

    it('ignores cross-origin calls even when the path starts with /api/', async () => {
      installOver(async () => new Response('{}', { status: 500 }))

      await window.fetch('https://other.example.com/api/thing')

      expect(apiEntries()).toEqual([])
    })

    it('ignores same-origin calls outside /api/', async () => {
      installOver(async () => new Response('{}', { status: 200 }))

      await window.fetch('/admin/dashboard')
      await window.fetch('/apiece-of-html')

      expect(apiEntries()).toEqual([])
    })

    it('passes an unresolvable input straight through without logging', async () => {
      const mock = installOver(async () => new Response('{}', { status: 200 }))

      await window.fetch({ nonsense: true } as unknown as RequestInfo)

      expect(apiEntries()).toEqual([])
      expect(mock).toHaveBeenCalledTimes(1)
    })

    it('never stores request bodies or headers', async () => {
      installOver(async () => new Response(JSON.stringify({ secret: 'response-body' })))

      await window.fetch('/api/issues', {
        method: 'POST',
        headers: { Authorization: 'Bearer super-secret-token', Cookie: 'session=abc' },
        body: JSON.stringify({ password: 'hunter2', tfn: '123456789' }),
      })

      const raw = localStorage.getItem(ISSUE_API_CALLS_KEY) ?? ''
      for (const forbidden of [
        'hunter2',
        '123456789',
        'super-secret-token',
        'session=abc',
        'Authorization',
        'response-body',
      ]) {
        expect(raw).not.toContain(forbidden)
      }

      // The stored entry carries metadata keys only.
      expect(Object.keys(apiEntries()[0]).sort()).toEqual(
        ['at', 'durationMs', 'error', 'method', 'ok', 'path', 'status'].sort(),
      )
    })

    it('never stores a response body on failure either', async () => {
      installOver(async () => {
        throw new Error('Failed to fetch https://internal/api?token=leaky')
      })

      await expect(window.fetch('/api/x', { body: 'secret-payload' })).rejects.toThrow()

      const raw =
        (localStorage.getItem(ISSUE_API_CALLS_KEY) ?? '') +
        (localStorage.getItem(ISSUE_ERRORS_KEY) ?? '')
      expect(raw).not.toContain('secret-payload')
    })
  })

  describe('5xx event', () => {
    it('dispatches issue-reporter:5xx with the path and status on a 500', async () => {
      installOver(async () => new Response('{}', { status: 500 }))

      const listener = vi.fn()
      window.addEventListener(ISSUE_5XX_EVENT, listener)

      await window.fetch('/api/ledger/repayment', { method: 'POST' })

      window.removeEventListener(ISSUE_5XX_EVENT, listener)

      expect(listener).toHaveBeenCalledTimes(1)
      const event = listener.mock.calls[0][0] as CustomEvent
      expect(event.detail).toEqual({ path: '/api/ledger/repayment', status: 500 })
    })

    it('dispatches for a 503 too', async () => {
      installOver(async () => new Response('{}', { status: 503 }))

      const listener = vi.fn()
      window.addEventListener(ISSUE_5XX_EVENT, listener)
      await window.fetch('/api/x')
      window.removeEventListener(ISSUE_5XX_EVENT, listener)

      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('does not dispatch for a 4xx', async () => {
      installOver(async () => new Response('{}', { status: 422 }))

      const listener = vi.fn()
      window.addEventListener(ISSUE_5XX_EVENT, listener)
      await window.fetch('/api/x')
      window.removeEventListener(ISSUE_5XX_EVENT, listener)

      expect(listener).not.toHaveBeenCalled()
    })

    it('does not dispatch for a cross-origin 500', async () => {
      installOver(async () => new Response('{}', { status: 500 }))

      const listener = vi.fn()
      window.addEventListener(ISSUE_5XX_EVENT, listener)
      await window.fetch('https://other.example.com/api/x')
      window.removeEventListener(ISSUE_5XX_EVENT, listener)

      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('rejections', () => {
    it('logs an api entry with the error name and rethrows the original error', async () => {
      const boom = new TypeError('Failed to fetch')
      installOver(async () => {
        throw boom
      })

      await expect(window.fetch('/api/x', { method: 'DELETE' })).rejects.toBe(boom)

      const entry = apiEntries()[0]
      expect(entry).toMatchObject({
        method: 'DELETE',
        path: '/api/x',
        status: null,
        ok: false,
        error: 'TypeError',
      })
    })

    it('logs a fetch-failed entry to the errors buffer', async () => {
      installOver(async () => {
        throw new TypeError('Failed to fetch')
      })

      await expect(window.fetch('/api/x', { method: 'POST' })).rejects.toThrow()

      const errors = errorEntries()
      expect(errors).toHaveLength(1)
      expect(errors[0].source).toBe('fetch-failed')
      expect(errors[0].message).toContain('POST /api/x failed')
      expect(errors[0].message).toContain('Failed to fetch')
      expect(errors[0]).toHaveProperty('stack')
    })

    it('caps the logged message and stack lengths', async () => {
      const err = new Error('m'.repeat(2000))
      err.stack = 's'.repeat(5000)
      installOver(async () => {
        throw err
      })

      await expect(window.fetch('/api/x')).rejects.toThrow()

      const [entry] = errorEntries()
      expect(entry.message.length).toBeLessThanOrEqual(500)
      expect((entry.stack ?? '').length).toBeLessThanOrEqual(2000)
    })

    it('rethrows without logging for a non-tracked (cross-origin) url', async () => {
      const boom = new Error('nope')
      installOver(async () => {
        throw boom
      })

      await expect(window.fetch('https://other.example.com/x')).rejects.toBe(boom)

      expect(apiEntries()).toEqual([])
      expect(errorEntries()).toEqual([])
    })
  })

  describe('transparency', () => {
    it('returns the original response object unchanged', async () => {
      const response = new Response('{"a":1}', { status: 200 })
      installOver(async () => response)

      const result = await window.fetch('/api/x')

      expect(result).toBe(response)
      expect(await result.json()).toEqual({ a: 1 })
    })

    it('forwards input and init to the original fetch untouched', async () => {
      const mock = installOver(async () => new Response('{}'))
      const init = { method: 'POST', body: 'x' }

      await window.fetch('/api/x', init)

      expect(mock).toHaveBeenCalledWith('/api/x', init)
    })

    it('does not break the caller when the buffer write throws', async () => {
      const response = new Response('{}', { status: 200 })
      installOver(async () => response)
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })

      await expect(window.fetch('/api/x')).resolves.toBe(response)
    })
  })

  describe('idempotency', () => {
    it('does not double-wrap when installed twice', async () => {
      const mock = installOver(async () => new Response('{}', { status: 200 }))
      const afterFirst = window.fetch

      installFetchTracker()

      expect(window.fetch).toBe(afterFirst)

      await window.fetch('/api/x')

      expect(mock).toHaveBeenCalledTimes(1)
      expect(apiEntries()).toHaveLength(1)
    })

    it('is a no-op when window.fetch is not a function', () => {
      // @ts-expect-error deliberately clobbering fetch
      window.fetch = undefined

      expect(() => installFetchTracker()).not.toThrow()
      expect(window.fetch).toBeUndefined()
    })
  })
})
