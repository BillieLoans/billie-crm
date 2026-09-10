/**
 * Self-signed client token for billie-platform-services gRPC (platform ADR-0001).
 *
 * The CRM holds an Ed25519 private key whose public half is registered in the
 * platform's `src/grpc_clients.<env>.json`. Every call carries a five-minute
 * JWT signed with it. No identity provider, no token endpoint, no cache to
 * expire. When the env vars are absent the client sends no token (local dev
 * against GRPC_AUTH_MODE=off).
 */
import { createPrivateKey, KeyObject } from 'node:crypto'
import * as grpc from '@grpc/grpc-js'
import { SignJWT } from 'jose'

export const PLATFORM_AUDIENCE = 'billie-platform-services'
export const TOKEN_TTL_S = 300

export type PlatformClientConfig = {
  clientId: string
  keyId: string
  privateKeyPem: string
  audience: string
}

let keyCache: { pem: string; key: KeyObject } | null = null

export function configFromEnv(): PlatformClientConfig | null {
  const clientId = process.env.PLATFORM_CLIENT_ID
  const keyId = process.env.PLATFORM_CLIENT_KEY_ID
  const raw = process.env.PLATFORM_CLIENT_PRIVATE_KEY
  if (!clientId || !keyId || !raw) return null
  return {
    clientId,
    keyId,
    privateKeyPem: raw.replace(/\\n/g, '\n'),
    audience: process.env.PLATFORM_AUDIENCE || PLATFORM_AUDIENCE,
  }
}

export function isPlatformAuthConfigured(): boolean {
  return configFromEnv() !== null
}

function privateKeyFor(pem: string): KeyObject {
  if (!keyCache || keyCache.pem !== pem) keyCache = { pem, key: createPrivateKey(pem) }
  return keyCache.key
}

export async function signPlatformToken(cfg = configFromEnv(), nowMs = Date.now()): Promise<string> {
  if (!cfg) throw new Error('platform auth is not configured (PLATFORM_CLIENT_* env vars)')
  const nowS = Math.floor(nowMs / 1000)
  return new SignJWT({})
    .setProtectedHeader({ alg: 'EdDSA', kid: cfg.keyId })
    .setIssuer(cfg.clientId)
    .setSubject(cfg.clientId)
    .setAudience(cfg.audience)
    .setIssuedAt(nowS)
    .setExpirationTime(nowS + TOKEN_TTL_S)
    .sign(privateKeyFor(cfg.privateKeyPem))
}

/** Metadata for every platform gRPC call: bearer token when configured, else empty. */
export async function platformMetadata(): Promise<grpc.Metadata> {
  const md = new grpc.Metadata()
  const cfg = configFromEnv()
  if (!cfg) return md
  md.set('authorization', `Bearer ${await signPlatformToken(cfg)}`)
  return md
}

export function resetPlatformAuthForTests(): void {
  keyCache = null
}
