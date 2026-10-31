import { Profiler } from 'react'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { DisbursementPaymentPanel } from '@/components/PendingDisbursementsView/DisbursementPaymentPanel'
import type { QueueItem } from '@/components/PendingDisbursementsView/DisbursementSection'
import { useAnnouncerStore } from '@/stores/announcer'

const writeText = vi.fn().mockResolvedValue(undefined)

const CHECK_URL = '/api/ledger/disbursable'
const ACCESS_LOG_URL = '/api/pending-disbursements/access-log'

const DISBURSABLE = {
  disbursable: true,
  reason: 'DISBURSABLE',
  status: 'PENDING_DISBURSEMENT',
  message: '',
}

type FetchResult = { ok: boolean; status: number; json: () => Promise<unknown> }

const reply = (body: unknown, status = 200): FetchResult => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

/**
 * What the platform-check request does. Each test replaces it; the default is a
 * platform that says the loan can be paid, so the pre-existing panel tests run
 * against the panel as the operator sees it once the platform has answered.
 */
let checkHandler: (url: string) => Promise<FetchResult>

/** The calls made to one URL (any query string), in order. */
function callsTo(prefix: string) {
  return (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
    ([url]) => String(url).startsWith(prefix),
  )
}

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    loanAccountId: 'a1',
    accountNumber: 'LN-1',
    applicationNumber: 'F92C001D-AB9',
    customerId: 'c1',
    customerName: 'Kathryn Shine',
    ekycVerifiedName: 'Kathryn Shine',
    ekycStatus: 'successful' as const,
    loanAmount: 200,
    loanAmountFormatted: '$200.00',
    commencementDate: '2026-08-28',
    firstDueDate: '2026-09-04',
    bucket: 'today',
    signedLoanAgreementUrl: 's3://bucket/agreement.pdf',
    disbursementAccount: {
      holder: 'Mr Rohan C Sharp & Ms Kathryn F Shine',
      bsb: '923100',
      bsbFormatted: '923-100',
      number: '63764292',
      isComplete: true,
      missing: [],
    },
    oskoMessage: 'Billie Pay Advance F92C001D-AB9. First repayment 04/09/2026.',
    ...overrides,
  }
}

/** Render the panel and wait for the platform to say the loan can be paid. */
async function renderReady(item: QueueItem = makeItem(), onDisburse = vi.fn()) {
  const view = render(<DisbursementPaymentPanel item={item} onDisburse={onDisburse} />)
  await screen.findByTestId('panel-disburse')
  return view
}

/**
 * Nothing an operator could pay from: no payout fields, no copy actions, no
 * agreement link, no payment message, no Confirmation of Payee, no Mark disbursed.
 */
function expectNoPayoutDetails() {
  expect(screen.queryByText('Pay to')).not.toBeInTheDocument()
  expect(screen.queryByText('BSB')).not.toBeInTheDocument()
  expect(screen.queryByText('Account name')).not.toBeInTheDocument()
  expect(screen.queryByText('Account number')).not.toBeInTheDocument()
  expect(screen.queryByText('Amount')).not.toBeInTheDocument()
  expect(screen.queryByTestId('payout-value-accountNumber')).not.toBeInTheDocument()
  expect(screen.queryByText(/923-100/)).not.toBeInTheDocument()
  expect(screen.queryByText(/63764292|4292/)).not.toBeInTheDocument()
  expect(screen.queryByText(/Rohan C Sharp/)).not.toBeInTheDocument()
  expect(screen.queryByText(/\$200\.00/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /copy all details/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /reveal/i })).not.toBeInTheDocument()
  expect(screen.queryByText(/open signed agreement/i)).not.toBeInTheDocument()
  expect(screen.queryByTestId('osko-message')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /copy message/i })).not.toBeInTheDocument()
  expect(screen.queryByText(/confirmation of payee/i)).not.toBeInTheDocument()
  expect(screen.queryByTestId('panel-disburse')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /mark disbursed/i })).not.toBeInTheDocument()
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  })
  useAnnouncerStore.getState().reset()
  checkHandler = async () => reply(DISBURSABLE)
  global.fetch = vi.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url.startsWith(CHECK_URL)) return checkHandler(url)
    return Promise.resolve(reply({}))
  }) as unknown as typeof fetch
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DisbursementPaymentPanel', () => {
  it('masks the account number until it is explicitly revealed', async () => {
    await renderReady()
    const value = screen.getByTestId('payout-value-accountNumber')
    expect(value.textContent).not.toContain('63764292')
    expect(value.textContent).toContain('4292')
  })

  it('reveals the account number on explicit action and audits it', async () => {
    await renderReady()
    fireEvent.click(screen.getByRole('button', { name: /reveal/i }))

    expect(screen.getByTestId('payout-value-accountNumber').textContent).toContain('63764292')
    await waitFor(() => expect(callsTo(ACCESS_LOG_URL)).toHaveLength(1))
    const [url, init] = callsTo(ACCESS_LOG_URL)[0]
    expect(url).toBe(ACCESS_LOG_URL)
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      action: 'reveal',
      field: 'accountNumber',
      loanAccountId: 'a1',
    })
  })

  it('copies the full account number without needing to reveal it', async () => {
    await renderReady()
    fireEvent.click(screen.getByTestId('payout-copy-accountNumber'))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('63764292'))
    // Still masked on screen — copying does not expose it.
    expect(screen.getByTestId('payout-value-accountNumber').textContent).not.toContain('63764292')
  })

  it('audits a copy, because the clipboard discloses just as effectively', async () => {
    await renderReady()
    fireEvent.click(screen.getByTestId('payout-copy-accountNumber'))

    await waitFor(() => expect(callsTo(ACCESS_LOG_URL)).toHaveLength(1))
    const [, init] = callsTo(ACCESS_LOG_URL)[0]
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      action: 'copy',
      field: 'accountNumber',
    })
  })

  it('disables Mark disbursed until the payee name is confirmed', async () => {
    await renderReady()
    expect(screen.getByTestId('panel-disburse')).toBeDisabled()
  })

  it('enables Mark disbursed once the names are confirmed to match', async () => {
    const onDisburse = vi.fn()
    await renderReady(makeItem(), onDisburse)
    fireEvent.click(screen.getByLabelText(/names match/i))

    const btn = screen.getByTestId('panel-disburse')
    expect(btn).toBeEnabled()
    fireEvent.click(btn)
    expect(onDisburse).toHaveBeenCalledTimes(1)
  })

  it('stops the disbursement and says why when the names differ', async () => {
    await renderReady()
    fireEvent.click(screen.getByLabelText(/names differ/i))

    expect(screen.getByTestId('panel-disburse')).toBeDisabled()
    expect(screen.getByRole('alert').textContent).toMatch(/do not disburse/i)
  })

  it('still lets an incomplete record be recorded once the name is confirmed', async () => {
    // "Mark disbursed" records a payment already made by hand in ANZ; it does not
    // move money. Blocking it here would strand the payment outside the ledger.
    const onDisburse = vi.fn()
    const item = makeItem({
      disbursementAccount: {
        holder: null,
        bsb: '923100',
        bsbFormatted: '923-100',
        number: null,
        isComplete: false,
        missing: ['account name', 'account number'],
      },
    })
    await renderReady(item, onDisburse)
    expect(screen.getByText(/do not pay from a partial record/i)).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(/names match/i))
    expect(screen.getByTestId('panel-disburse')).toBeEnabled()
    fireEvent.click(screen.getByTestId('panel-disburse'))
    expect(onDisburse).toHaveBeenCalledTimes(1)
  })

  it('lets a legacy loan with no payout details be recorded after the name check', async () => {
    // Every loan created before the payout details rode the account event looks
    // like this. They still have to be disbursable.
    const onDisburse = vi.fn()
    await renderReady(makeItem({ disbursementAccount: null }), onDisburse)
    expect(screen.getByText(/no nominated account on this loan/i)).toBeInTheDocument()
    expect(screen.getByTestId('panel-disburse')).toBeDisabled()

    fireEvent.click(screen.getByLabelText(/names match/i))
    expect(screen.getByTestId('panel-disburse')).toBeEnabled()
    fireEvent.click(screen.getByTestId('panel-disburse'))
    expect(onDisburse).toHaveBeenCalledTimes(1)
  })

  it('says why Mark disbursed is disabled even with no account on file', async () => {
    // A disabled button with no stated reason is a dead end for the operator.
    await renderReady(makeItem({ disbursementAccount: null }))
    expect(screen.getByText(/confirm the payee name/i)).toBeInTheDocument()
  })

  it('does not warn when eKYC succeeded', async () => {
    await renderReady()
    expect(screen.getByText(/eKYC-verified identity/i)).toBeInTheDocument()
    expect(screen.queryByText(/not verified/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/eKYC failed/i)).not.toBeInTheDocument()
  })

  it('distinguishes a FAILED identity check from one that never ran', async () => {
    // These must not read alike: one is a fraud signal, the other is missing data.
    const { unmount } = await renderReady(makeItem({ ekycStatus: 'failed' }))
    expect(screen.getByText(/eKYC failed/i)).toBeInTheDocument()
    expect(screen.getByText(/Identity check FAILED/i)).toBeInTheDocument()
    unmount()

    await renderReady(makeItem({ ekycStatus: 'unknown' }))
    expect(screen.queryByText(/eKYC failed/i)).not.toBeInTheDocument()
    expect(screen.getByText(/not verified/i)).toBeInTheDocument()
  })

  it('marks a pending eKYC check as incomplete rather than failed', async () => {
    await renderReady(makeItem({ ekycStatus: 'pending' }))
    expect(screen.getByText(/check not complete/i)).toBeInTheDocument()
    expect(screen.queryByText(/eKYC failed/i)).not.toBeInTheDocument()
  })

  it('still shows the payee name to compare when eKYC has not succeeded', async () => {
    // The operator has to check the bank's answer against something either way.
    await renderReady(makeItem({ ekycStatus: 'unknown' }))
    expect(screen.getByText(/Kathryn Shine/)).toBeInTheDocument()
  })

  it('shows the payment message with its length against the Osko limit', async () => {
    const item = makeItem()
    await renderReady(item)
    expect(screen.getByTestId('osko-message').textContent).toBe(item.oskoMessage)
    expect(screen.getByText(`${item.oskoMessage.length}/280`)).toBeInTheDocument()
  })

  it('copies every payment detail as one block', async () => {
    await renderReady()
    fireEvent.click(screen.getByRole('button', { name: /copy all details/i }))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const copied = writeText.mock.calls[0][0] as string
    expect(copied).toContain('923-100')
    expect(copied).toContain('63764292')
    expect(copied).toContain('$200.00')
    expect(copied).toContain('Billie Pay Advance')
  })
})

/**
 * BTB-517. The CRM is a projection and can show a stale status, so the panel asks
 * the platform whether DisburseLoan would accept the loan before it shows anything
 * an operator could pay from. "Mark disbursed" comes only AFTER the operator has
 * paid by hand in ANZ, so a refusal there is too late to stop the money.
 */
describe('DisbursementPaymentPanel: the platform check', () => {
  it('asks the platform about this loan when it opens', async () => {
    await renderReady(makeItem({ loanAccountId: 'LA/9 x' }))

    expect(callsTo(CHECK_URL)).toHaveLength(1)
    const [url, init] = callsTo(CHECK_URL)[0]
    expect(url).toBe('/api/ledger/disbursable?loanAccountId=LA%2F9%20x')
    // Never served from a cache: a stale answer is the whole problem.
    expect(init).toMatchObject({ cache: 'no-store' })
  })

  describe('while the platform has not answered', () => {
    it('says it is checking and shows no payout details', () => {
      checkHandler = () => new Promise<FetchResult>(() => {})
      render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)

      const status = screen.getByRole('status')
      expect(status.textContent).toBe('Checking with the platform that this loan can be paid…')
      expectNoPayoutDetails()
    })
  })

  describe('when the platform says the loan can be paid', () => {
    it('shows the payment panel and announces it politely', async () => {
      await renderReady()

      expect(screen.getByText('Pay to')).toBeInTheDocument()
      expect(screen.getByText('923-100')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /copy all details/i })).toBeInTheDocument()
      expect(screen.getByText(/open signed agreement/i)).toBeInTheDocument()
      expect(screen.getByTestId('osko-message')).toBeInTheDocument()
      expect(screen.getByText(/confirmation of payee/i)).toBeInTheDocument()
      expect(screen.getByTestId('panel-disburse')).toBeInTheDocument()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(screen.queryByTestId('disbursable-blocked')).not.toBeInTheDocument()

      const { polite, assertive } = useAnnouncerStore.getState()
      expect(polite).toMatch(/can be paid/i)
      expect(assertive).toBe('')
    })
  })

  describe('when the platform says the loan cannot be paid', () => {
    const refusal = (reason: string, status: string, message = '') =>
      reply({ disbursable: false, reason, status, message })

    it('CANCELLED: do not pay, says the queue may be stale, and shows no payout details', async () => {
      checkHandler = async () =>
        refusal('CANCELLED', 'CANCELLED', 'Loan is CANCELLED — cannot disburse.')
      render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toContain(
        '🛑 Do not pay. The platform has recorded this loan as cancelled before disbursement.',
      )
      expect(alert.textContent).toMatch(/stale update/i)
      expect(alert.textContent).toMatch(/refresh/i)
      expectNoPayoutDetails()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      // Nothing to retry: a cancelled loan stays cancelled.
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
      expect(useAnnouncerStore.getState().assertive).toMatch(/cancelled before disbursement/i)
      expect(useAnnouncerStore.getState().polite).toBe('')
    })

    it('ALREADY_DISBURSED: do not pay, so the loan is not paid twice', async () => {
      checkHandler = async () => refusal('ALREADY_DISBURSED', 'ACTIVE', 'Loan already disbursed')
      render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toBe(
        '🛑 Do not pay. The platform has already recorded a disbursement for this loan.',
      )
      expectNoPayoutDetails()
      expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
      expect(useAnnouncerStore.getState().assertive).toMatch(/already recorded a disbursement/i)
    })

    it('NOT_PENDING_DISBURSEMENT: names the status the platform holds', async () => {
      checkHandler = async () => refusal('NOT_PENDING_DISBURSEMENT', 'PENDING')
      render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toBe(
        "🛑 Do not pay. The platform says this loan is PENDING and can't be disbursed yet.",
      )
      expectNoPayoutDetails()
    })

    it('NOT_PENDING_DISBURSEMENT with no status: says the loan is not set up', async () => {
      checkHandler = async () => refusal('NOT_PENDING_DISBURSEMENT', '')
      render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toBe(
        "🛑 Do not pay. The platform says this loan is not set up and can't be disbursed yet.",
      )
      expectNoPayoutDetails()
    })

    it('NO_LEDGER_RECORD: do not pay yet, with a Retry that asks again', async () => {
      checkHandler = async () => refusal('NO_LEDGER_RECORD', '')
      render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toBe(
        "🛑 Do not pay yet. The platform hasn't finished setting up this loan's ledger. Try again in a minute.",
      )
      expectNoPayoutDetails()

      // The ledger catches up; Retry now gets the go-ahead.
      checkHandler = async () => reply(DISBURSABLE)
      fireEvent.click(screen.getByRole('button', { name: /retry/i }))
      expect(await screen.findByTestId('panel-disburse')).toBeInTheDocument()
      expect(callsTo(CHECK_URL)).toHaveLength(2)
    })

    it('an unfamiliar reason shows the platform message as a generic do-not-pay', async () => {
      checkHandler = async () =>
        refusal('FROZEN_FOR_REVIEW', 'ON_HOLD', 'Loan is frozen for a compliance review.')
      render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toBe('🛑 Do not pay. Loan is frozen for a compliance review.')
      expectNoPayoutDetails()
    })

    it('an unfamiliar reason with no message still says do not pay', async () => {
      // Also what a gRPC default (everything empty, disbursable false) looks like.
      checkHandler = async () => refusal('', '')
      render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toBe(
        "🛑 Do not pay. The platform says this loan can't be disbursed.",
      )
      expectNoPayoutDetails()
    })
  })

  describe('when the check cannot be completed it fails closed', () => {
    const FAILED = "🛑 Couldn't confirm with the platform that this loan can be paid. Don't pay until this clears."

    it('a rejected fetch: do not pay, Retry, no payout details', async () => {
      checkHandler = () => Promise.reject(new TypeError('Failed to fetch'))
      vi.spyOn(console, 'error').mockImplementation(() => {})
      render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toBe(FAILED)
      expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument()
      expectNoPayoutDetails()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(useAnnouncerStore.getState().assertive).toBe(FAILED)
    })

    it('a 503 from the route: do not pay, Retry, no payout details', async () => {
      checkHandler = async () =>
        reply({ error: 'DISBURSABLE_CHECK_FAILED', message: 'Could not confirm.' }, 503)
      vi.spyOn(console, 'error').mockImplementation(() => {})
      render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)

      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toBe(FAILED)
      expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument()
      expectNoPayoutDetails()
    })

    it.each([401, 404, 500])('a %i from the route also fails closed, with Retry', async (status) => {
      checkHandler = async () => reply({}, status)
      vi.spyOn(console, 'error').mockImplementation(() => {})
      render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)

      expect((await screen.findByRole('alert')).textContent).toBe(FAILED)
      expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument()
      expectNoPayoutDetails()
    })

    describe('a 403 is its own outcome: the role may not record disbursements', () => {
      const FORBIDDEN =
        "Your role can't record disbursements, so the payout details are hidden. Ask a servicing operator or supervisor."

      it('says so, with no Retry and no payout details', async () => {
        checkHandler = async () => reply({ error: { code: 'FORBIDDEN' } }, 403)
        vi.spyOn(console, 'error').mockImplementation(() => {})
        render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)

        const alert = await screen.findByRole('alert')
        expect(alert.textContent).toBe(FORBIDDEN)
        // Asking again cannot change a role, so there is nothing to retry.
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
        // Not the fail-closed "couldn't confirm" message, and not a status line either.
        expect(screen.queryByText(/couldn't confirm/i)).not.toBeInTheDocument()
        expect(screen.queryByRole('status')).not.toBeInTheDocument()
        expectNoPayoutDetails()
        expect(callsTo(CHECK_URL)).toHaveLength(1)
      })

      it('announces it assertively, and a 403 is an expected outcome that logs no error', async () => {
        checkHandler = async () => reply({}, 403)
        const error = vi.spyOn(console, 'error').mockImplementation(() => {})
        render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)
        await screen.findByRole('alert')

        expect(useAnnouncerStore.getState().assertive).toBe(FORBIDDEN)
        expect(useAnnouncerStore.getState().polite).toBe('')
        expect(error).not.toHaveBeenCalled()
      })

      it('is neutral: it does not use the red stop style', async () => {
        checkHandler = async () => reply({}, 403)
        render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)

        const alert = await screen.findByTestId('disbursable-forbidden')
        expect(screen.queryByTestId('disbursable-blocked')).not.toBeInTheDocument()
        expect(alert.className).toMatch(/notice/)
        expect(alert.className).not.toMatch(/stop/)
        expect(alert.textContent).not.toContain('🛑')
      })
    })

    it.each([
      ['an empty object', {}],
      ['a body with no verdict', { items: [], totalCount: 0 }],
      ['null', null],
      ['a string', 'ok'],
      ['a non-boolean verdict', { disbursable: 'true', reason: 'DISBURSABLE' }],
      ['a verdict with no reason', { disbursable: true }],
    ])('a 200 with %s fails closed', async (_name, body) => {
      checkHandler = async () => reply(body)
      vi.spyOn(console, 'error').mockImplementation(() => {})
      render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)

      expect((await screen.findByRole('alert')).textContent).toBe(FAILED)
      expectNoPayoutDetails()
    })

    it('a 200 whose body is not JSON fails closed', async () => {
      checkHandler = async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON')
        },
      })
      vi.spyOn(console, 'error').mockImplementation(() => {})
      render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)

      expect((await screen.findByRole('alert')).textContent).toBe(FAILED)
      expectNoPayoutDetails()
    })

    it('Retry asks again, shows no details meanwhile, and shows them once the platform says yes', async () => {
      checkHandler = async () => reply({}, 503)
      vi.spyOn(console, 'error').mockImplementation(() => {})
      render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)
      await screen.findByRole('alert')

      let answer!: (r: FetchResult) => void
      checkHandler = () => new Promise<FetchResult>((resolve) => (answer = resolve))
      fireEvent.click(screen.getByRole('button', { name: /^retry$/i }))

      // Awaiting the second answer: back to the neutral status, still nothing to pay from.
      expect(screen.getByRole('status').textContent).toMatch(/checking with the platform/i)
      expect(screen.queryByTestId('disbursable-blocked')).not.toBeInTheDocument()
      expectNoPayoutDetails()

      answer(reply(DISBURSABLE))
      expect(await screen.findByTestId('panel-disburse')).toBeInTheDocument()
      expect(callsTo(CHECK_URL)).toHaveLength(2)
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(useAnnouncerStore.getState().polite).toMatch(/can be paid/i)
    })

    it('Retry that fails again stays closed', async () => {
      checkHandler = async () => reply({}, 503)
      vi.spyOn(console, 'error').mockImplementation(() => {})
      render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)
      await screen.findByRole('alert')

      fireEvent.click(screen.getByRole('button', { name: /^retry$/i }))

      await waitFor(() => expect(callsTo(CHECK_URL)).toHaveLength(2))
      expect((await screen.findByRole('alert')).textContent).toBe(FAILED)
      expectNoPayoutDetails()
    })

    it('Retry that now gets a refusal shows the refusal, not the details', async () => {
      checkHandler = async () => reply({}, 503)
      vi.spyOn(console, 'error').mockImplementation(() => {})
      render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)
      await screen.findByRole('alert')

      checkHandler = async () =>
        reply({ disbursable: false, reason: 'CANCELLED', status: 'CANCELLED', message: '' })
      fireEvent.click(screen.getByRole('button', { name: /^retry$/i }))

      await waitFor(() =>
        expect(screen.getByRole('alert').textContent).toMatch(/recorded this loan as cancelled/i),
      )
      expectNoPayoutDetails()
    })
  })

  describe('keyboard focus', () => {
    const FAILED_503 = async () => reply({}, 503)

    it('does not take focus when the panel opens, whatever the answer', async () => {
      const outside = document.createElement('button')
      document.body.appendChild(outside)
      outside.focus()

      await renderReady()

      expect(document.activeElement).toBe(outside)
      outside.remove()
    })

    it('does not take focus when the opening check fails either', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      checkHandler = FAILED_503
      render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)
      await screen.findByRole('alert')

      expect(document.activeElement).toBe(document.body)
    })

    it('moves to the status line when Retry is clicked, instead of falling to the page', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      checkHandler = FAILED_503
      render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)
      await screen.findByRole('alert')
      const retry = screen.getByRole('button', { name: /^retry$/i })
      retry.focus()
      expect(document.activeElement).toBe(retry)

      checkHandler = () => new Promise<FetchResult>(() => {})
      fireEvent.click(retry)

      const status = screen.getByRole('status')
      expect(retry).not.toBeInTheDocument()
      expect(status).toHaveAttribute('tabindex', '-1')
      expect(document.activeElement).toBe(status)
    })

    it('moves to the first heading of the payment details when the answer after a Retry is yes', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      checkHandler = FAILED_503
      render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)
      await screen.findByRole('alert')

      let answer!: (r: FetchResult) => void
      checkHandler = () => new Promise<FetchResult>((resolve) => (answer = resolve))
      fireEvent.click(screen.getByRole('button', { name: /^retry$/i }))
      expect(document.activeElement).toBe(screen.getByRole('status'))

      answer(reply(DISBURSABLE))
      await screen.findByTestId('panel-disburse')

      const heading = screen.getByRole('heading', { name: 'Pay to' })
      expect(heading).toHaveAttribute('tabindex', '-1')
      expect(document.activeElement).toBe(heading)
    })

    it('moves to the stop message when the answer after a Retry is a refusal', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      checkHandler = FAILED_503
      render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)
      await screen.findByRole('alert')

      checkHandler = async () =>
        reply({ disbursable: false, reason: 'CANCELLED', status: 'CANCELLED', message: '' })
      fireEvent.click(screen.getByRole('button', { name: /^retry$/i }))

      const blocked = await screen.findByTestId('disbursable-blocked')
      expect(blocked).toHaveAttribute('tabindex', '-1')
      expect(document.activeElement).toBe(blocked)
    })

    it('moves to the check-failed message when a Retry fails again, so Retry can be pressed again', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      checkHandler = FAILED_503
      render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)
      await screen.findByRole('alert')

      fireEvent.click(screen.getByRole('button', { name: /^retry$/i }))

      await waitFor(() => expect(callsTo(CHECK_URL)).toHaveLength(2))
      const blocked = await screen.findByTestId('disbursable-blocked')
      await waitFor(() => expect(document.activeElement).toBe(blocked))
    })

    it('follows a NO_LEDGER_RECORD Retry from the refusal through to the payment details', async () => {
      checkHandler = async () =>
        reply({ disbursable: false, reason: 'NO_LEDGER_RECORD', status: '', message: '' })
      render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)
      await screen.findByRole('alert')
      expect(document.activeElement).toBe(document.body)

      checkHandler = async () => reply(DISBURSABLE)
      fireEvent.click(screen.getByRole('button', { name: /^retry$/i }))
      await screen.findByTestId('panel-disburse')
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Pay to' }))
    })
  })

  describe('a superseded or abandoned check', () => {
    it('ignores an earlier answer that lands after the panel moved to another loan', async () => {
      const pending: Record<string, (r: FetchResult) => void> = {}
      checkHandler = (url) =>
        new Promise<FetchResult>((resolve) => {
          pending[new URL(url, 'http://crm.test').searchParams.get('loanAccountId')!] = resolve
        })
      const first = makeItem({ loanAccountId: 'a1' })
      const second = makeItem({ loanAccountId: 'a2' })
      const { rerender } = render(<DisbursementPaymentPanel item={first} onDisburse={vi.fn()} />)
      rerender(<DisbursementPaymentPanel item={second} onDisburse={vi.fn()} />)
      await waitFor(() => expect(Object.keys(pending).sort()).toEqual(['a1', 'a2']))

      // The newer loan is cleared; then the older loan's slower refusal arrives.
      pending.a2(reply(DISBURSABLE))
      expect(await screen.findByTestId('panel-disburse')).toBeInTheDocument()
      pending.a1(
        reply({ disbursable: false, reason: 'CANCELLED', status: 'CANCELLED', message: '' }),
      )
      await new Promise((r) => setTimeout(r, 0))

      // The panel still shows the loan it is on, untouched by the stale answer.
      expect(screen.getByTestId('panel-disburse')).toBeInTheDocument()
      expect(screen.queryByTestId('disbursable-blocked')).not.toBeInTheDocument()
    })

    it('does not let an earlier "yes" land on a loan whose own answer is a refusal', async () => {
      const pending: Record<string, (r: FetchResult) => void> = {}
      checkHandler = (url) =>
        new Promise<FetchResult>((resolve) => {
          pending[new URL(url, 'http://crm.test').searchParams.get('loanAccountId')!] = resolve
        })
      const { rerender } = render(
        <DisbursementPaymentPanel item={makeItem({ loanAccountId: 'a1' })} onDisburse={vi.fn()} />,
      )
      rerender(
        <DisbursementPaymentPanel item={makeItem({ loanAccountId: 'a2' })} onDisburse={vi.fn()} />,
      )
      await waitFor(() => expect(Object.keys(pending).sort()).toEqual(['a1', 'a2']))

      pending.a2(
        reply({ disbursable: false, reason: 'CANCELLED', status: 'CANCELLED', message: '' }),
      )
      await screen.findByTestId('disbursable-blocked')
      pending.a1(reply(DISBURSABLE))
      await new Promise((r) => setTimeout(r, 0))

      expect(screen.getByTestId('disbursable-blocked')).toBeInTheDocument()
      expectNoPayoutDetails()
    })

    it('shows no verdict from an earlier ask when the panel comes back to the same loan', async () => {
      const first = makeItem({ loanAccountId: 'a1' })
      const other = makeItem({ loanAccountId: 'a2' })
      const { rerender } = render(<DisbursementPaymentPanel item={first} onDisburse={vi.fn()} />)
      await screen.findByTestId('panel-disburse')

      // Away to another loan, then back to a1 while the platform is slow to answer.
      checkHandler = () => new Promise<FetchResult>(() => {})
      rerender(<DisbursementPaymentPanel item={other} onDisburse={vi.fn()} />)
      rerender(<DisbursementPaymentPanel item={first} onDisburse={vi.fn()} />)

      expect(screen.getByRole('status').textContent).toMatch(/checking with the platform/i)
      expectNoPayoutDetails()
    })

    it('never commits a render with payout details for loan B before B\'s own verdict', async () => {
      // The panel is moved from loan A (answered, details showing) to loan B whose
      // check is pending. The hook derives `checking` from the request key on the
      // render that changes the loan, so no committed render may carry details
      // for B until B's own verdict lands. Every commit is observed through a
      // Profiler: its onRender runs after React has mutated the DOM for that
      // commit, so the snapshot is exactly what the browser could paint.
      const commits: string[] = []
      const loanA = makeItem({ loanAccountId: 'a1' })
      const loanB = makeItem({
        loanAccountId: 'b2',
        applicationNumber: 'B2B2B2B2-XYZ',
        oskoMessage: 'Billie Pay Advance B2B2B2B2-XYZ.',
        disbursementAccount: {
          holder: 'Ms Bee Two',
          bsb: '062000',
          bsbFormatted: '062-000',
          number: '11112222',
          isComplete: true,
          missing: [],
        },
      })
      const tree = (item: QueueItem) => (
        <Profiler id="panel" onRender={() => commits.push(document.body.innerHTML)}>
          <DisbursementPaymentPanel item={item} onDisburse={vi.fn()} />
        </Profiler>
      )

      const { rerender } = render(tree(loanA))
      await screen.findByTestId('panel-disburse')
      expect(commits[commits.length - 1]).toContain('923-100')

      let answerB!: (r: FetchResult) => void
      checkHandler = () => new Promise<FetchResult>((resolve) => (answerB = resolve))
      const before = commits.length
      rerender(tree(loanB))
      await waitFor(() => expect(callsTo(CHECK_URL)).toHaveLength(2))

      // B is awaiting its own verdict: only the status line has ever been committed for it.
      expect(commits.length).toBeGreaterThan(before)
      for (const html of commits.slice(before)) {
        expect(html).not.toContain('062-000')
        expect(html).not.toContain('Ms Bee Two')
        expect(html).not.toContain('923-100')
        expect(html).not.toContain('data-testid="panel-disburse"')
        expect(html).not.toContain('data-testid="osko-message"')
        expect(html).toContain('Checking with the platform')
      }

      // And B's own verdict then shows B's details.
      answerB(reply(DISBURSABLE))
      await screen.findByTestId('panel-disburse')
      expect(commits[commits.length - 1]).toContain('062-000')
    })

    it('abandons the request when the panel closes: aborts it, and a late answer announces nothing', async () => {
      let answer!: (r: FetchResult) => void
      checkHandler = () => new Promise<FetchResult>((resolve) => (answer = resolve))
      const { unmount } = render(<DisbursementPaymentPanel item={makeItem()} onDisburse={vi.fn()} />)
      await waitFor(() => expect(callsTo(CHECK_URL)).toHaveLength(1))
      const [, init] = callsTo(CHECK_URL)[0]
      const signal = (init as RequestInit).signal as AbortSignal
      expect(signal.aborted).toBe(false)

      unmount()
      expect(signal.aborted).toBe(true)

      // A mock fetch ignores the signal, so the answer still arrives. It lands on
      // nothing: no announcement for a panel nobody is looking at.
      answer(reply({ disbursable: false, reason: 'CANCELLED', status: 'CANCELLED', message: '' }))
      await new Promise((r) => setTimeout(r, 0))
      expect(useAnnouncerStore.getState().assertive).toBe('')
      expect(useAnnouncerStore.getState().polite).toBe('')
    })
  })
})
