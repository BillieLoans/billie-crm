/**
 * API Route: POST /api/ledger/cancel-account
 *
 * Cancel a loan before disbursement (BTB-517). A supervisor or admin takes a
 * PENDING / PENDING_DISBURSEMENT loan to the terminal CANCELLED state through
 * the ledger's CancelAccount RPC, which publishes account.cancelled.v1. The
 * CRM's own status, cancellation fields and instalment statuses follow from
 * that event (event-processor handle_account_cancelled); this route writes none
 * of them.
 *
 * Request body:
 * - loanAccountId (required)
 * - reason (required): mutual_cancellation | customer_withdrew | offer_lapsed |
 *   fraud_hold | duplicate
 * - note (required): at least 20 characters after trimming
 * - evidenceRef: required for mutual_cancellation
 * - blockConfirmation (required): { kind: 'manual_block_active' } (re-checked here
 *   against the customer's block) or { kind: 'no_block_needed', reason } (10+ chars)
 * - idempotencyKey (required): a uuid, minted once per form and reused on retry.
 *   Retrying after a 503 with the same key completes the cancel.
 *
 * On success it also writes the pinned system contact note. The cancel is the
 * thing that matters: if the note fails, the route still answers success and
 * says so with `noteError: true`. A completed cancel is never reported as failed.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { Payload } from 'payload'
import { getLedgerClient } from '@/server/grpc-client'
import { handleApiError, createValidationError, createApiError } from '@/lib/utils/api-error'
import { ERROR_CODES } from '@/lib/errors/codes'
import { requireAuth } from '@/lib/auth'
import { hasApprovalAuthority } from '@/lib/access'
import { CancelAccountSchema, type CancelAccount } from '@/lib/schemas/ledger'
import { isBlockActive } from '@/lib/reapplicationBlock'
import { textToTiptapDoc } from '@/lib/tiptap'
import { buildCancellationNoteText, CANCELLATION_NOTE_SUBJECT } from '@/lib/cancellation'
import { staffDisplayName } from '@/lib/staffDisplayName'
import type { Customer, LoanAccount, User } from '@/payload-types'

const ACTION = 'cancel-account'

// gRPC status codes this route maps itself.
// https://grpc.io/docs/guides/status-codes/
const GRPC_INVALID_ARGUMENT = 3
const GRPC_FAILED_PRECONDITION = 9
const GRPC_ABORTED = 10
const GRPC_UNAVAILABLE = 14

async function findCustomer(payload: Payload, customerId: string): Promise<Customer | null> {
  const result = await payload.find({
    collection: 'customers',
    where: { customerId: { equals: customerId } },
    limit: 1,
    depth: 0,
  })
  return result.docs[0] ?? null
}

/**
 * The customer the supervisor sees on the account: the one on the loan, or the
 * canonical record it was merged into (an identity link leaves a tombstone
 * behind that carries no live block).
 */
async function findCanonicalCustomer(payload: Payload, customerId: string) {
  const customer = await findCustomer(payload, customerId)
  if (customer?.mergedInto && customer.mergedInto !== customer.customerId) {
    return findCustomer(payload, customer.mergedInto)
  }
  return customer
}

interface LoanContext {
  loan: LoanAccount | null
  customer: Customer | null
}

async function loadLoanContext(payload: Payload, loanAccountId: string): Promise<LoanContext> {
  const loans = await payload.find({
    collection: 'loan-accounts',
    where: { loanAccountId: { equals: loanAccountId } },
    limit: 1,
    depth: 0,
  })
  const loan = loans.docs[0] ?? null
  const customer = loan?.customerIdString
    ? await findCanonicalCustomer(payload, loan.customerIdString)
    : null
  return { loan, customer }
}

/** AC16: the block the supervisor says is in place must be an active MANUAL_ADMIN block. */
function hasActiveManualBlock(customer: Customer | null): boolean {
  const block = customer?.reapplicationBlock
  return Boolean(block && isBlockActive(block) && block.reason === 'MANUAL_ADMIN')
}

/**
 * Write the pinned system contact note for this cancel, unless one is already
 * there (a retry, or an idempotent replay of a cancel whose first response was
 * lost). Never throws; returns false when the note could not be left.
 */
async function ensureCancellationNote(
  payload: Payload,
  user: User,
  args: {
    data: CancelAccount
    actorName: string
    cancelledAt: string
    context?: LoanContext
  },
): Promise<boolean> {
  const { data } = args
  try {
    const { loan, customer } = args.context ?? (await loadLoanContext(payload, data.loanAccountId))
    if (!loan || !customer) {
      console.error(
        `[${ACTION}] cancelled ${data.loanAccountId}, but the contact note was not written: ` +
          `${loan ? 'customer' : 'loan account'} not found in the CRM projection`,
      )
      return false
    }

    const existing = await payload.find({
      collection: 'contact-notes',
      where: {
        and: [
          { loanAccount: { equals: loan.id } },
          { channel: { equals: 'system' } },
          { topic: { equals: 'account_update' } },
          { subject: { equals: CANCELLATION_NOTE_SUBJECT } },
        ],
      },
      limit: 1,
      depth: 0,
    })
    if (existing.docs.length > 0) return true

    await payload.create({
      collection: 'contact-notes',
      data: {
        customer: customer.id,
        loanAccount: loan.id,
        channel: 'system',
        topic: 'account_update',
        subject: CANCELLATION_NOTE_SUBJECT,
        // The collection's beforeChange hook sets `createdBy` from `user` as well,
        // and `status` defaults to active; the create type needs both present.
        createdBy: user.id,
        status: 'active',
        content: textToTiptapDoc(
          buildCancellationNoteText({
            reason: data.reason,
            note: data.note,
            actorName: args.actorName,
            cancelledAt: args.cancelledAt,
            evidenceRef: data.evidenceRef,
          }),
        ),
      },
      user,
    })
    return true
  } catch (error) {
    console.error(
      `[${ACTION}] cancelled ${data.loanAccountId}, but the contact note could not be written:`,
      error,
    )
    return false
  }
}

export async function POST(request: NextRequest) {
  let loanAccountId: string | undefined
  try {
    const auth = await requireAuth(hasApprovalAuthority)
    if ('error' in auth) return auth.error
    const { user, payload } = auth

    const body = await request.json().catch(() => null)
    const parseResult = CancelAccountSchema.safeParse(body)
    if (!parseResult.success) {
      return createValidationError(parseResult.error.flatten().fieldErrors)
    }
    const data = parseResult.data
    loanAccountId = data.loanAccountId

    // A claimed manual block is checked against the customer record here, not
    // taken on the browser's word (AC16). "No block needed" has nothing to check.
    let context: LoanContext | undefined
    if (data.blockConfirmation.kind === 'manual_block_active') {
      context = await loadLoanContext(payload, data.loanAccountId)
      if (!context.loan) {
        return createApiError(ERROR_CODES.ACCOUNT_NOT_FOUND, {
          details: { action: ACTION, accountId: data.loanAccountId },
        })
      }
      if (!hasActiveManualBlock(context.customer)) {
        return NextResponse.json(
          {
            error: 'BLOCK_REQUIRED',
            message:
              'This customer has no active manual re-application block. Set the block before cancelling, or confirm that none is needed.',
          },
          { status: 422 },
        )
      }
    }

    const actorName = staffDisplayName(user)

    // The block confirmation is not part of the note or the ledger record; it
    // is recorded here, with the actor.
    console.info(`[${ACTION}] block confirmation`, {
      loanAccountId: data.loanAccountId,
      actorId: String(user.id),
      blockConfirmation: data.blockConfirmation,
    })

    const response = await getLedgerClient().cancelAccount({
      loanAccountId: data.loanAccountId,
      reasonCode: data.reason,
      note: data.note,
      evidenceRef: data.evidenceRef || undefined,
      actorId: String(user.id),
      actorName,
      idempotencyKey: data.idempotencyKey,
    })

    // Only a recorded cancel gets a note. An idempotent replay gets one too if
    // the first attempt never managed to leave it.
    const noteWritten = response.success
      ? await ensureCancellationNote(payload, user, {
          data,
          actorName,
          cancelledAt: response.cancelledAt || new Date().toISOString(),
          context,
        })
      : true

    return NextResponse.json({
      success: response.success,
      message: response.message,
      eventId: response.eventId,
      cancelledAt: response.cancelledAt,
      previousStatus: response.previousStatus,
      idempotentReplay: response.idempotentReplay,
      noteError: !noteWritten,
    })
  } catch (error) {
    const grpcCode = (error as { code?: unknown } | undefined)?.code
    const grpcDetails = (error as { details?: unknown } | undefined)?.details
    const details = typeof grpcDetails === 'string' && grpcDetails ? grpcDetails : undefined

    switch (grpcCode) {
      // `account is not cancellable in status ACTIVE`, `funds already disbursed`:
      // a business-rule refusal. Retrying cannot change it.
      case GRPC_FAILED_PRECONDITION:
        return NextResponse.json(
          { error: 'NOT_CANCELLABLE', message: details ?? 'This loan cannot be cancelled.' },
          { status: 422 },
        )
      case GRPC_INVALID_ARGUMENT:
        return NextResponse.json(
          { error: 'VALIDATION', message: details ?? 'The ledger rejected the request.' },
          { status: 400 },
        )
      // Another writer holds the account lock (a disbursement, say). Nothing was
      // changed; the same request can be sent again.
      case GRPC_ABORTED:
        return NextResponse.json(
          {
            error: 'ACCOUNT_BUSY',
            message: 'Another change is being applied to this account. Try again in a moment.',
          },
          { status: 409 },
        )
      // The cancel may be only part-way through (the publish failed). Resending
      // the same idempotency key completes it without cancelling twice.
      case GRPC_UNAVAILABLE:
        return createApiError(ERROR_CODES.LEDGER_UNAVAILABLE, {
          message:
            'The cancellation was not completed. Try again: sending the same request again completes it without cancelling twice.',
          details: { action: ACTION, accountId: loanAccountId, service: 'ledger', grpcCode },
        })
    }

    return handleApiError(error, { action: ACTION, accountId: loanAccountId })
  }
}
