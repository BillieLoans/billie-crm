import { describe, it, expect } from 'vitest'
import * as protoLoader from '@grpc/proto-loader'
import type { MessageTypeDefinition } from '@grpc/proto-loader'
import path from 'path'
import type {
  UpsertContactInput,
  SetConsentInput,
  LogInteractionInput,
} from '@/server/marketing-grpc-client'

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

// Task C5 follow-up: the staff command routes (src/app/api/marketing/contacts/**)
// call updateContact/setConsent/logInteraction/eraseContact, none of which had
// this real-proto guard yet — only UpsertContactRequest did. Same casing
// regression risk applies to every one of these request messages, since they
// all go through the same keepCase:false loader. Extend the guard to
// SetConsentRequest and LogInteractionRequest (the two with the most fields,
// and the ones most likely to silently regress: `sourceSystem`, `occurredAt`,
// `metadataJson`, `channels`, `evidence`).
const SetConsentRequestType = packageDefinition[
  'billie.marketing.SetConsentRequest'
] as MessageTypeDefinition<object, Record<string, unknown>>

const LogInteractionRequestType = packageDefinition[
  'billie.marketing.LogInteractionRequest'
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

  it('round-trips a camelCase SetConsentInput through the real proto without dropping fields', () => {
    const request: SetConsentInput = {
      idempotencyKey: 'idem-consent-1',
      contactId: 'contact-abc',
      granted: false,
      channels: ['sms', 'whatsapp'],
      method: 'staff_request',
      evidence: 'verbal, phone call 2026-07-03',
      actor: '42',
    }

    const wire = SetConsentRequestType.serialize(request)
    const decoded = SetConsentRequestType.deserialize(wire)

    expect(decoded.idempotencyKey).toBe(request.idempotencyKey)
    expect(decoded.contactId).toBe(request.contactId)
    expect(decoded.granted).toBe(request.granted)
    expect(decoded.channels).toEqual(request.channels)
    expect(decoded.method).toBe(request.method)
    expect(decoded.evidence).toBe(request.evidence)
    expect(decoded.actor).toBe(request.actor)
  })

  it('round-trips a camelCase LogInteractionInput through the real proto without dropping fields', () => {
    const request: LogInteractionInput = {
      idempotencyKey: 'idem-interaction-1',
      contactId: 'contact-abc',
      kind: 'note',
      channel: 'phone',
      direction: 'outbound',
      subject: 'Follow-up call',
      body: 'Called to confirm mobile number',
      sourceSystem: 'crm',
      occurredAt: '2026-07-03T09:00:00.000Z',
      metadataJson: JSON.stringify({ staffId: '42' }),
      actor: '42',
    }

    const wire = LogInteractionRequestType.serialize(request)
    const decoded = LogInteractionRequestType.deserialize(wire)

    expect(decoded.idempotencyKey).toBe(request.idempotencyKey)
    expect(decoded.contactId).toBe(request.contactId)
    expect(decoded.kind).toBe(request.kind)
    expect(decoded.channel).toBe(request.channel)
    expect(decoded.direction).toBe(request.direction)
    expect(decoded.subject).toBe(request.subject)
    expect(decoded.body).toBe(request.body)
    expect(decoded.sourceSystem).toBe(request.sourceSystem)
    expect(decoded.occurredAt).toBe(request.occurredAt)
    expect(decoded.metadataJson).toBe(request.metadataJson)
    expect(decoded.actor).toBe(request.actor)
  })

  it('TEETH CHECK: a snake_case request object silently drops fields under keepCase:false', () => {
    // Proves the guard above actually has teeth: if someone "fixes" the
    // client to send snake_case keys (matching the .proto text, but wrong
    // for this loader's keepCase:false setting), proto-loader treats them
    // as unrecognised properties on the message and they decode back as
    // empty/default — no exception, no visible failure at the call site.
    const wrongCaseRequest = {
      idempotency_key: 'idem-consent-2',
      contact_id: 'contact-def',
      granted: true,
      channels: ['email'],
      method: 'checkbox',
      evidence: 'web form',
      actor: '7',
    }

    const wire = SetConsentRequestType.serialize(wrongCaseRequest as unknown as SetConsentInput)
    const decoded = SetConsentRequestType.deserialize(wire)

    // Only fields whose camelCase spelling actually differs from snake_case
    // (i.e. names with an underscore to transform) are useful
    // discriminators here: `idempotency_key`/`contact_id` never reach the
    // proto's real `idempotencyKey`/`contactId` fields and decode back to
    // empty. `method`, `evidence`, `actor`, `granted`, `channels` have no
    // underscore in either casing, so they'd round-trip fine either way —
    // asserting on them would make this test pass even with the
    // regression it's meant to catch (a false negative), so we don't.
    expect(decoded.idempotencyKey).toBe('')
    expect(decoded.contactId).toBe('')
    // Sanity: the wrong-case object we sent really did carry these values —
    // this test isn't accidentally passing because the input was empty.
    expect(wrongCaseRequest.idempotency_key).toBe('idem-consent-2')
    expect(wrongCaseRequest.contact_id).toBe('contact-def')
  })
})
