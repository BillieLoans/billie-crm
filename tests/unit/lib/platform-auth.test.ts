// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { jwtVerify } from 'jose'
import {
  PLATFORM_AUDIENCE,
  TOKEN_TTL_S,
  configFromEnv,
  isPlatformAuthConfigured,
  platformMetadata,
  resetPlatformAuthForTests,
  signPlatformToken,
} from '@/server/platform-auth'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string

describe('platform-auth', () => {
  beforeEach(() => {
    resetPlatformAuthForTests()
    process.env.PLATFORM_CLIENT_ID = 'billie-crm'
    process.env.PLATFORM_CLIENT_KEY_ID = 'billie-crm-202609'
    process.env.PLATFORM_CLIENT_PRIVATE_KEY = PEM
    delete process.env.PLATFORM_AUDIENCE
  })
  afterEach(() => {
    delete process.env.PLATFORM_CLIENT_ID
    delete process.env.PLATFORM_CLIENT_KEY_ID
    delete process.env.PLATFORM_CLIENT_PRIVATE_KEY
    resetPlatformAuthForTests()
  })

  it('is configured only when all three env vars are present', () => {
    expect(isPlatformAuthConfigured()).toBe(true)
    delete process.env.PLATFORM_CLIENT_PRIVATE_KEY
    expect(isPlatformAuthConfigured()).toBe(false)
    expect(configFromEnv()).toBeNull()
  })

  it('signs an EdDSA token with the contract claims and kid header', async () => {
    const token = await signPlatformToken(undefined, 1_700_000_000_000)
    const { payload, protectedHeader } = await jwtVerify(token, publicKey, {
      issuer: 'billie-crm',
      subject: 'billie-crm',
      audience: PLATFORM_AUDIENCE,
      currentDate: new Date(1_700_000_001_000),
    })
    expect(protectedHeader.alg).toBe('EdDSA')
    expect(protectedHeader.kid).toBe('billie-crm-202609')
    expect(payload.iat).toBe(1_700_000_000)
    expect(payload.exp).toBe(1_700_000_000 + TOKEN_TTL_S)
  })

  it('tolerates a PEM with escaped newlines (as pasted into some secret UIs)', async () => {
    process.env.PLATFORM_CLIENT_PRIVATE_KEY = PEM.replace(/\n/g, '\\n')
    resetPlatformAuthForTests()
    const token = await signPlatformToken()
    await expect(jwtVerify(token, publicKey, { audience: PLATFORM_AUDIENCE })).resolves.toBeTruthy()
  })

  it('honours PLATFORM_AUDIENCE', async () => {
    process.env.PLATFORM_AUDIENCE = 'other-aud'
    const token = await signPlatformToken()
    await expect(jwtVerify(token, publicKey, { audience: 'other-aud' })).resolves.toBeTruthy()
  })

  it('platformMetadata attaches the bearer token, or nothing when unconfigured', async () => {
    const md = await platformMetadata()
    expect(md.get('authorization')[0]).toMatch(/^Bearer eyJ/)
    delete process.env.PLATFORM_CLIENT_ID
    resetPlatformAuthForTests()
    const empty = await platformMetadata()
    expect(empty.get('authorization')).toEqual([])
  })
})
