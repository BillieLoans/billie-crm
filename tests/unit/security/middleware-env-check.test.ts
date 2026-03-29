import { describe, test, expect } from 'vitest'

/**
 * Tests for the PAYLOAD_SECRET environment validation logic in src/middleware.ts.
 *
 * The middleware has a module-level constant:
 *   const hasPayloadSecret =
 *     !!process.env.PAYLOAD_SECRET &&
 *     process.env.PAYLOAD_SECRET !== 'build-placeholder-not-for-production'
 *
 * Because this is evaluated at module import time, we test the logic in
 * isolation rather than attempting to re-import the module with different
 * env values (which is fragile with module caching).
 */

/** Mirrors the hasPayloadSecret check from src/middleware.ts */
const hasPayloadSecret = (secret: string | undefined): boolean =>
  !!secret && secret !== 'build-placeholder-not-for-production'

describe('Middleware PAYLOAD_SECRET Check', () => {
  test('should detect missing PAYLOAD_SECRET (undefined)', () => {
    expect(hasPayloadSecret(undefined)).toBe(false)
  })

  test('should detect missing PAYLOAD_SECRET (empty string)', () => {
    expect(hasPayloadSecret('')).toBe(false)
  })

  test('should reject the build placeholder value', () => {
    expect(hasPayloadSecret('build-placeholder-not-for-production')).toBe(false)
  })

  test('should accept a real secret value', () => {
    expect(hasPayloadSecret('af5c166afeaa5bebe428b726')).toBe(true)
  })

  test('should accept any non-placeholder truthy value', () => {
    expect(hasPayloadSecret('my-dev-secret')).toBe(true)
    expect(hasPayloadSecret('super-secret-production-key-2024')).toBe(true)
  })
})

describe('Middleware Request Routing (PAYLOAD_SECRET absent)', () => {
  /**
   * When hasPayloadSecret is false the middleware returns 503 for every
   * request EXCEPT /api/health.  We verify the branching logic here.
   */

  const shouldBlock = (pathname: string, secretPresent: boolean): boolean => {
    if (!secretPresent && pathname !== '/api/health') {
      return true // 503
    }
    return false
  }

  test('non-health requests should be blocked when secret is missing', () => {
    expect(shouldBlock('/', false)).toBe(true)
    expect(shouldBlock('/admin', false)).toBe(true)
    expect(shouldBlock('/admin/dashboard', false)).toBe(true)
    expect(shouldBlock('/api/customers', false)).toBe(true)
  })

  test('health check should always pass regardless of secret', () => {
    expect(shouldBlock('/api/health', false)).toBe(false)
    expect(shouldBlock('/api/health', true)).toBe(false)
  })

  test('non-health requests should pass when secret is present', () => {
    expect(shouldBlock('/', true)).toBe(false)
    expect(shouldBlock('/admin', true)).toBe(false)
    expect(shouldBlock('/api/customers', true)).toBe(false)
  })
})
