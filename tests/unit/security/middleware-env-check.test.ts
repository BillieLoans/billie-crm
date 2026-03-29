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

describe('Middleware Cloudflare Origin Check (H9 Remediation)', () => {
  /**
   * Mirrors the verifyCloudflareOrigin logic from src/middleware.ts:
   * - DISABLE_CF_SECRET_CHECK=true → allow through
   * - CF_SECRET not set + production → block (fail closed)
   * - CF_SECRET not set + non-production → allow through
   * - CF_SECRET set + header matches → allow through
   * - CF_SECRET set + header doesn't match → block
   */

  type CfCheckResult = 'allow' | 'block'

  const verifyCfOrigin = (opts: {
    disableCheck?: string
    cfSecret?: string
    nodeEnv?: string
    originHeader?: string
  }): CfCheckResult => {
    if (opts.disableCheck === 'true') return 'allow'

    if (!opts.cfSecret) {
      if (opts.nodeEnv === 'production') return 'block'
      return 'allow'
    }

    if (opts.originHeader !== opts.cfSecret) return 'block'
    return 'allow'
  }

  test('should allow when DISABLE_CF_SECRET_CHECK is true', () => {
    expect(verifyCfOrigin({ disableCheck: 'true' })).toBe('allow')
    expect(verifyCfOrigin({ disableCheck: 'true', nodeEnv: 'production' })).toBe('allow')
  })

  test('should block in production when CF_SECRET is not set (fail closed)', () => {
    expect(verifyCfOrigin({ nodeEnv: 'production' })).toBe('block')
    expect(verifyCfOrigin({ cfSecret: undefined, nodeEnv: 'production' })).toBe('block')
  })

  test('should allow in non-production when CF_SECRET is not set', () => {
    expect(verifyCfOrigin({ nodeEnv: 'development' })).toBe('allow')
    expect(verifyCfOrigin({ nodeEnv: undefined })).toBe('allow')
  })

  test('should allow when CF_SECRET matches origin header', () => {
    expect(verifyCfOrigin({
      cfSecret: 'my-secret',
      originHeader: 'my-secret',
      nodeEnv: 'production',
    })).toBe('allow')
  })

  test('should block when CF_SECRET does not match origin header', () => {
    expect(verifyCfOrigin({
      cfSecret: 'my-secret',
      originHeader: 'wrong-secret',
      nodeEnv: 'production',
    })).toBe('block')
  })

  test('should block when origin header is missing', () => {
    expect(verifyCfOrigin({
      cfSecret: 'my-secret',
      originHeader: undefined,
      nodeEnv: 'production',
    })).toBe('block')
  })
})

describe('Middleware JWT Expiry Check (M4 Remediation)', () => {
  /**
   * Mirrors the isJwtNotExpired logic from src/middleware.ts.
   * Decodes JWT payload and checks `exp` claim without signature verification.
   */
  const isJwtNotExpired = (token: string | undefined): boolean => {
    if (!token) return false
    try {
      const parts = token.split('.')
      if (parts.length !== 3) return false
      const payload = JSON.parse(atob(parts[1]))
      if (typeof payload.exp !== 'number') return false
      return payload.exp > Math.floor(Date.now() / 1000)
    } catch {
      return false
    }
  }

  /** Helper to create a JWT-shaped token with a given exp */
  const makeToken = (exp: number): string => {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const payload = btoa(JSON.stringify({ id: 'user-1', email: 'test@test.com', exp }))
    return `${header}.${payload}.fake-signature`
  }

  test('should return false for undefined token', () => {
    expect(isJwtNotExpired(undefined)).toBe(false)
  })

  test('should return false for empty string', () => {
    expect(isJwtNotExpired('')).toBe(false)
  })

  test('should return false for garbage string', () => {
    expect(isJwtNotExpired('not-a-jwt')).toBe(false)
  })

  test('should return false for token with only 2 parts', () => {
    expect(isJwtNotExpired('header.payload')).toBe(false)
  })

  test('should return false for expired token', () => {
    const expired = makeToken(Math.floor(Date.now() / 1000) - 3600) // 1 hour ago
    expect(isJwtNotExpired(expired)).toBe(false)
  })

  test('should return true for valid non-expired token', () => {
    const valid = makeToken(Math.floor(Date.now() / 1000) + 3600) // 1 hour from now
    expect(isJwtNotExpired(valid)).toBe(true)
  })

  test('should return false for token with no exp claim', () => {
    const header = btoa(JSON.stringify({ alg: 'HS256' }))
    const payload = btoa(JSON.stringify({ id: 'user-1' })) // no exp
    const token = `${header}.${payload}.sig`
    expect(isJwtNotExpired(token)).toBe(false)
  })

  test('should return false for token with non-numeric exp', () => {
    const header = btoa(JSON.stringify({ alg: 'HS256' }))
    const payload = btoa(JSON.stringify({ id: 'user-1', exp: 'never' }))
    const token = `${header}.${payload}.sig`
    expect(isJwtNotExpired(token)).toBe(false)
  })
})
