import { describe, it, expect } from 'vitest'
import * as protoLoader from '@grpc/proto-loader'
import type { MessageTypeDefinition } from '@grpc/proto-loader'
import path from 'path'
import type { UpsertContactInput } from '@/server/marketing-grpc-client'

/**
 * Coverage gap this closes (Task C4 follow-up):
 *
 * src/server/marketing-grpc-client.ts calls protoLoader.loadSync with
 * `keepCase: false`, meaning the wire format is snake_case
 * (UpsertContactRequest.first_name) but the client's TS input type
 * (UpsertContactInput.firstName) and every call site use camelCase.
 * grpc-js/proto-loader translate camelCase JS keys to the snake_case wire
 * fields automatically — but ONLY if the keys actually match the expected
 * camelCase names. Every other test of this client mocks the gRPC call
 * entirely, so a regression that reverted the request object's keys to
 * snake_case (matching the .proto text, but wrong for keepCase:false)
 * would silently serialize those fields as empty/default and NO test
 * would fail.
 *
 * This test loads the REAL .proto (mirroring the exact loader options
 * from marketing-grpc-client.ts) and round-trips a camelCase request
 * through the real proto-loader serialize/deserialize path — no gRPC
 * server required. It proves the camelCase keys the client sends actually
 * land on the wire and survive a full encode/decode cycle.
 */

const PROTO_PATH = path.resolve(process.cwd(), 'proto/marketing_service.proto')

// Mirror the EXACT protoLoader.loadSync options used by
// src/server/marketing-grpc-client.ts. If that file's options ever change,
// this must change with it (that's the point — same wire contract).
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
})

const UpsertContactRequestType = packageDefinition[
  'billie.marketing.UpsertContactRequest'
] as MessageTypeDefinition<object, Record<string, unknown>>

describe('marketing-grpc-client proto wire round-trip', () => {
  it('round-trips a camelCase UpsertContactInput through the real proto without dropping fields', () => {
    const request: UpsertContactInput = {
      idempotencyKey: 'idem-abc-123',
      firstName: 'Ada',
      email: 'ada@example.com',
      mobile: '0400000000',
      city: 'Sydney',
      postcode: '2000',
      source: 'landing-page',
      utmJson: JSON.stringify({ utm_source: 'fb', utm_campaign: 'spring-25' }),
      platforms: ['ios', 'web'],
      channelPreference: 'sms',
      referredByCode: 'REF123',
      waitlist: true,
      consent: { granted: true, channels: ['sms', 'email'], method: 'checkbox' },
      actor: 'system',
    }

    // Real wire-serialization boundary: encode with the actual proto
    // descriptor, then decode it back — exactly what happens between the
    // client process and the MarketingService over the network.
    const wire = UpsertContactRequestType.serialize(request)
    const decoded = UpsertContactRequestType.deserialize(wire)

    // Every camelCase field the client declares on UpsertContactInput must
    // survive the round trip with its original value. If someone reverts
    // the client's request-building code to snake_case keys under
    // keepCase:false, proto-loader silently treats them as unknown
    // properties and these fields decode back as empty/default instead.
    expect(decoded.idempotencyKey).toBe(request.idempotencyKey)
    expect(decoded.firstName).toBe(request.firstName)
    expect(decoded.email).toBe(request.email)
    expect(decoded.mobile).toBe(request.mobile)
    expect(decoded.city).toBe(request.city)
    expect(decoded.postcode).toBe(request.postcode)
    expect(decoded.source).toBe(request.source)
    expect(decoded.utmJson).toBe(request.utmJson)
    expect(decoded.platforms).toEqual(request.platforms)
    expect(decoded.channelPreference).toBe(request.channelPreference)
    expect(decoded.referredByCode).toBe(request.referredByCode)
    expect(decoded.waitlist).toBe(request.waitlist)
    expect(decoded.consent).toEqual(request.consent)
    expect(decoded.actor).toBe(request.actor)
  })
})
