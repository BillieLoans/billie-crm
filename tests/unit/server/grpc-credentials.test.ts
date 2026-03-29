import { describe, it, expect } from 'vitest'

/**
 * Tests the URL classification logic used by LedgerClient to determine
 * whether to use insecure (plaintext) or TLS credentials for gRPC.
 *
 * Extracted from src/server/grpc-client.ts LedgerClient constructor:
 *   url.includes('.internal') || url.startsWith('localhost') || url.startsWith('127.')
 */
function isInternalOrLocal(url: string): boolean {
  return url.includes('.internal') || url.startsWith('localhost') || url.startsWith('127.')
}

describe('gRPC Credential Selection', () => {
  describe('isInternalOrLocal', () => {
    it('should return true for Fly.io internal addresses', () => {
      expect(isInternalOrLocal('billie-platform-services-prod.internal:50051')).toBe(true)
      expect(isInternalOrLocal('my-service.internal:443')).toBe(true)
    })

    it('should return true for localhost', () => {
      expect(isInternalOrLocal('localhost:50051')).toBe(true)
    })

    it('should return true for localhost without port', () => {
      expect(isInternalOrLocal('localhost')).toBe(true)
    })

    it('should return true for 127.x addresses', () => {
      expect(isInternalOrLocal('127.0.0.1:50051')).toBe(true)
      expect(isInternalOrLocal('127.0.0.1')).toBe(true)
    })

    it('should return false for external addresses', () => {
      expect(isInternalOrLocal('api.example.com:443')).toBe(false)
      expect(isInternalOrLocal('ledger.billie.loans:50051')).toBe(false)
    })

    it('should return false for addresses that merely contain "localhost" as a substring', () => {
      // url.startsWith('localhost') should not match subdomains
      expect(isInternalOrLocal('notlocalhost:50051')).toBe(false)
    })

    it('should return true for .internal anywhere in the hostname', () => {
      // url.includes('.internal') matches anywhere in the string
      expect(isInternalOrLocal('service.internal')).toBe(true)
      expect(isInternalOrLocal('deep.nested.internal:50051')).toBe(true)
    })
  })
})
