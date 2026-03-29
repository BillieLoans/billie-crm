import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPayload } from 'payload'
import { requireAuth } from '@/lib/auth'

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue('payload-token=test'),
  }),
}))

vi.mock('payload', () => ({
  getPayload: vi.fn(),
}))

vi.mock('@payload-config', () => ({
  default: {},
}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}))

const mockGetPayload = vi.mocked(getPayload)

describe('requireAuth', () => {
  const mockUser = {
    id: 'user-1',
    email: 'test@billie.com.au',
    role: 'admin',
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return 401 error when user is not authenticated', async () => {
    const mockPayload = {
      auth: vi.fn().mockResolvedValue({ user: null }),
    }
    mockGetPayload.mockResolvedValue(mockPayload as any)

    const result = await requireAuth()

    expect(result).toHaveProperty('error')
    expect('error' in result).toBe(true)

    if ('error' in result) {
      expect(result.error.status).toBe(401)
      expect(result.error.body).toEqual({
        error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue.' },
      })
    }
  })

  it('should return 403 error when access check fails', async () => {
    const mockPayload = {
      auth: vi.fn().mockResolvedValue({ user: mockUser }),
    }
    mockGetPayload.mockResolvedValue(mockPayload as any)

    const denyAll = () => false
    const result = await requireAuth(denyAll)

    expect(result).toHaveProperty('error')
    expect('error' in result).toBe(true)

    if ('error' in result) {
      expect(result.error.status).toBe(403)
      expect(result.error.body).toEqual({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to perform this action.',
        },
      })
    }
  })

  it('should return user and payload when authenticated with no access check', async () => {
    const mockPayload = {
      auth: vi.fn().mockResolvedValue({ user: mockUser }),
    }
    mockGetPayload.mockResolvedValue(mockPayload as any)

    const result = await requireAuth()

    expect(result).not.toHaveProperty('error')
    expect('user' in result).toBe(true)
    expect('payload' in result).toBe(true)

    if ('user' in result) {
      expect(result.user).toEqual(mockUser)
      expect(result.payload).toBe(mockPayload)
    }
  })

  it('should return user and payload when authenticated and access check passes', async () => {
    const mockPayload = {
      auth: vi.fn().mockResolvedValue({ user: mockUser }),
    }
    mockGetPayload.mockResolvedValue(mockPayload as any)

    const allowAll = () => true
    const result = await requireAuth(allowAll)

    expect(result).not.toHaveProperty('error')
    expect('user' in result).toBe(true)
    expect('payload' in result).toBe(true)

    if ('user' in result) {
      expect(result.user).toEqual(mockUser)
      expect(result.payload).toBe(mockPayload)
    }
  })

  it('should have correct JSON structure for 401 error response', async () => {
    const mockPayload = {
      auth: vi.fn().mockResolvedValue({ user: null }),
    }
    mockGetPayload.mockResolvedValue(mockPayload as any)

    const result = await requireAuth()

    expect('error' in result).toBe(true)
    if ('error' in result) {
      const { body } = result.error as any
      expect(body).toHaveProperty('error')
      expect(body.error).toHaveProperty('code')
      expect(body.error).toHaveProperty('message')
      expect(body.error.code).toBe('UNAUTHENTICATED')
      expect(typeof body.error.message).toBe('string')
    }
  })

  it('should have correct JSON structure for 403 error response', async () => {
    const mockPayload = {
      auth: vi.fn().mockResolvedValue({ user: mockUser }),
    }
    mockGetPayload.mockResolvedValue(mockPayload as any)

    const denyAll = () => false
    const result = await requireAuth(denyAll)

    expect('error' in result).toBe(true)
    if ('error' in result) {
      const { body } = result.error as any
      expect(body).toHaveProperty('error')
      expect(body.error).toHaveProperty('code')
      expect(body.error).toHaveProperty('message')
      expect(body.error.code).toBe('FORBIDDEN')
      expect(typeof body.error.message).toBe('string')
    }
  })

  it('should pass the cookie header from the request to payload.auth', async () => {
    const mockAuth = vi.fn().mockResolvedValue({ user: mockUser })
    const mockPayload = { auth: mockAuth }
    mockGetPayload.mockResolvedValue(mockPayload as any)

    await requireAuth()

    expect(mockAuth).toHaveBeenCalledOnce()
    const callArgs = mockAuth.mock.calls[0][0]
    expect(callArgs).toHaveProperty('headers')
    expect(callArgs.headers).toBeInstanceOf(Headers)
    expect(callArgs.headers.get('cookie')).toBe('payload-token=test')
  })

  it('should call the access check function with the authenticated user', async () => {
    const mockPayload = {
      auth: vi.fn().mockResolvedValue({ user: mockUser }),
    }
    mockGetPayload.mockResolvedValue(mockPayload as any)

    const accessCheck = vi.fn().mockReturnValue(true)
    await requireAuth(accessCheck)

    expect(accessCheck).toHaveBeenCalledOnce()
    expect(accessCheck).toHaveBeenCalledWith(mockUser)
  })
})
