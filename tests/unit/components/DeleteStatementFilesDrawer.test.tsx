/**
 * DeleteStatementFilesButton + DeleteStatementFilesDrawer: a supervisor
 * permanently deletes a customer's bank-statement files from S3.
 *
 * Drives the real button, drawer and hooks; only `fetch` and the signed-in
 * user are stubbed. The flow is the stepped one docs/ux-standards.md asks of
 * an irreversible action: Review (with a reason), Confirm (type DELETE), Result.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { DeleteStatementFilesButton } from '@/components/StatementDeletion/DeleteStatementFilesButton'
import { DELETION_WARNING_COPY, KEPT_DATA_COPY } from '@/lib/statement-deletion'
import type {
  ApplicationPreview,
  ApplicationResult,
  DeletionScope,
} from '@/server/statement-deletion'

const auth = vi.hoisted(() => ({
  user: { id: 'sup-1', role: 'supervisor' } as { id: string; role: string } | null,
}))
vi.mock('@payloadcms/ui', () => ({ useAuth: () => ({ user: auth.user }) }))

const SCOPE: DeletionScope = { scope: 'customer', customerIdString: 'CUS-1' }
const TITLE = 'Delete statement files for Cass Customer'

const APP_1: ApplicationPreview = {
  conversationId: 'conv-1',
  applicationNumber: 'APP-1',
  fileCount: 3,
  warnings: ['funded_loan'],
}
const APP_2: ApplicationPreview = {
  conversationId: 'conv-2',
  applicationNumber: 'APP-2',
  fileCount: 0,
  warnings: [],
}

const json = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

type FakeResponse = ReturnType<typeof json>

/** A response the test hands over later, to hold a request in flight. */
function deferred() {
  let resolve!: (res: FakeResponse) => void
  const promise = new Promise<FakeResponse>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const fetchMock = vi.fn()
let previewApps: ApplicationPreview[]
/** Responses for the next preview requests, in order; then `previewApps`. */
let previewQueue: Array<FakeResponse | Promise<FakeResponse>>
let deleteResponse: FakeResponse | Promise<FakeResponse>

function installFetch() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/statements/deletion/preview') {
      return previewQueue.shift() ?? json(200, { applications: previewApps })
    }
    if (url === '/api/statements/deletion' && init?.method === 'POST') {
      return deleteResponse
    }
    return json(404, { error: { code: 'NOT_FOUND', message: `Unexpected ${url}` } })
  })
}

const callsTo = (path: string) => fetchMock.mock.calls.filter(([url]) => url === path)

let client: QueryClient

function renderButton() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <DeleteStatementFilesButton scope={SCOPE} label="Delete statement files" title={TITLE} />
    </QueryClientProvider>,
  )
}

const dialog = () => screen.getByRole('dialog', { name: TITLE })

/** Open the drawer and wait for the preview and for the drawer's own focus. */
async function openDrawer() {
  renderButton()
  fireEvent.click(screen.getByRole('button', { name: 'Delete statement files' }))
  await screen.findByText('APP-1 · 3 files')
  await waitFor(() => expect(document.activeElement).toBe(dialog()))
}

const reasonBox = () => within(dialog()).getByLabelText('Reason')
const continueBtn = () => within(dialog()).getByRole('button', { name: 'Continue' })

async function goToConfirm(reason = 'Customer asked us to delete their statements.') {
  await openDrawer()
  fireEvent.change(reasonBox(), { target: { value: reason } })
  fireEvent.click(continueBtn())
  await screen.findByRole('heading', { name: 'Confirm deletion' })
}

const confirmInput = () => within(dialog()).getByLabelText('Type DELETE to confirm')

function submitDelete() {
  fireEvent.change(confirmInput(), { target: { value: 'DELETE' } })
  fireEvent.click(within(dialog()).getByRole('button', { name: 'Delete 3 files' }))
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  auth.user = { id: 'sup-1', role: 'supervisor' }
  previewApps = [APP_1, APP_2]
  previewQueue = []
  const deleted: ApplicationResult = {
    ...APP_1,
    status: 'deleted',
    filesDeleted: 3,
    failedCount: 0,
  }
  deleteResponse = json(200, { results: [deleted] })
  installFetch()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('DeleteStatementFilesButton: who sees it', () => {
  it('renders nothing for an operations user', () => {
    auth.user = { id: 'ops-1', role: 'operations' }
    const { container } = renderButton()
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button', { name: 'Delete statement files' })).toBeNull()
  })

  it('renders for a supervisor', () => {
    renderButton()
    expect(screen.getByRole('button', { name: 'Delete statement files' })).toBeInTheDocument()
  })
})

describe('DeleteStatementFilesDrawer: review', () => {
  it('lists each application with its file count, its warnings and what is kept', async () => {
    await openDrawer()

    expect(screen.getByText('APP-1 · 3 files')).toBeInTheDocument()
    expect(screen.getByText('APP-2 · No files')).toBeInTheDocument()
    expect(screen.getByText(DELETION_WARNING_COPY.funded_loan)).toBeInTheDocument()
    expect(screen.queryByText(DELETION_WARNING_COPY.in_progress)).toBeNull()
    expect(screen.getByText(KEPT_DATA_COPY)).toBeInTheDocument()

    expect(callsTo('/api/statements/deletion/preview')).toHaveLength(1)
    const [, init] = callsTo('/api/statements/deletion/preview')[0]
    expect(JSON.parse(init.body)).toEqual(SCOPE)
  })

  it('a failed background re-check is announced but leaves focus in the reason', async () => {
    await openDrawer()
    reasonBox().focus()
    fireEvent.change(reasonBox(), { target: { value: 'Customer req' } })
    previewQueue.push(json(500, { error: { code: 'INTERNAL_ERROR', message: 'S3 is down.' } }))

    await client.invalidateQueries({ queryKey: ['statement-deletion-preview'] })

    expect(await screen.findByRole('alert')).toHaveTextContent('S3 is down.')
    expect(document.activeElement).toBe(reasonBox())
  })

  it('keeps Continue disabled until a reason is entered', async () => {
    await openDrawer()

    expect(continueBtn()).toBeDisabled()
    fireEvent.change(reasonBox(), { target: { value: '   ' } })
    expect(continueBtn()).toBeDisabled()
    fireEvent.change(reasonBox(), { target: { value: 'Customer request' } })
    expect(continueBtn()).toBeEnabled()
  })

  it('says no files were found, and Continue stays disabled', async () => {
    previewApps = [{ ...APP_1, fileCount: 0 }, APP_2]
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: 'Delete statement files' }))

    expect(await screen.findByText('No statement files found.')).toBeInTheDocument()
    fireEvent.change(reasonBox(), { target: { value: 'Customer request' } })
    expect(continueBtn()).toBeDisabled()
  })
})

describe('DeleteStatementFilesDrawer: confirm', () => {
  it('states what will go, and needs DELETE typed exactly', async () => {
    await goToConfirm()

    const heading = screen.getByRole('heading', { name: 'Confirm deletion' })
    expect(document.activeElement).toBe(heading)
    expect(
      screen.getByText(
        "3 files across 1 application will be permanently deleted. They can't be recovered.",
      ),
    ).toBeInTheDocument()

    const deleteBtn = within(dialog()).getByRole('button', { name: 'Delete 3 files' })
    expect(deleteBtn).toBeDisabled()
    fireEvent.change(confirmInput(), { target: { value: 'delete' } })
    expect(deleteBtn).toBeDisabled()
    fireEvent.change(confirmInput(), { target: { value: 'DELETE' } })
    expect(deleteBtn).toBeEnabled()
  })

  it('Back returns to the review with the reason kept', async () => {
    await goToConfirm('Keep me')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Back' }))

    const heading = await screen.findByRole('heading', { name: 'Review files to delete' })
    expect(document.activeElement).toBe(heading)
    expect(reasonBox()).toHaveValue('Keep me')
  })
})

describe('DeleteStatementFilesDrawer: delete', () => {
  it('POSTs the scope and the trimmed reason, and no keys', async () => {
    await goToConfirm('  Customer asked us to delete their statements.  ')
    submitDelete()

    expect(await screen.findByText(/Deleted \(3 files\)/)).toBeInTheDocument()
    const posts = callsTo('/api/statements/deletion')
    expect(posts).toHaveLength(1)
    const body = JSON.parse(posts[0][1].body)
    expect(body).toEqual({
      scope: 'customer',
      customerIdString: 'CUS-1',
      reason: 'Customer asked us to delete their statements.',
    })
    expect(body).not.toHaveProperty('keys')
    expect(screen.queryByText('Some files could not be deleted')).toBeNull()
  })

  it('a partial result says what remains, and Retry goes back to a fresh review', async () => {
    deleteResponse = json(200, {
      results: [{ ...APP_1, status: 'partial', filesDeleted: 2, failedCount: 1 }],
    })
    await goToConfirm()
    // The delete settling re-checks the bucket; hold that answer back.
    const recheck = deferred()
    previewQueue.push(recheck.promise)
    submitDelete()

    const heading = await screen.findByRole('heading', {
      name: 'Some files could not be deleted',
    })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(screen.getByText(/Failed — 1 of 3 files remain/)).toBeInTheDocument()

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('heading', { name: 'Review files to delete' })).toBeVisible()
    // The old counts are not shown while the re-check is out.
    expect(screen.getByText('Checking for statement files…')).toBeInTheDocument()
    expect(screen.queryByText('APP-1 · 3 files')).toBeNull()

    recheck.resolve(json(200, { applications: [{ ...APP_1, fileCount: 1 }] }))
    expect(await screen.findByText('APP-1 · 1 file')).toBeInTheDocument()
    // The first preview and the one re-check: Retry does not ask again.
    expect(callsTo('/api/statements/deletion/preview')).toHaveLength(2)
  })

  it('cannot be closed while the delete is in flight, so the outcome is shown', async () => {
    const pending = deferred()
    deleteResponse = pending.promise
    await goToConfirm()
    submitDelete()
    await screen.findByText('Deleting files. Keep this drawer open.')

    const closeX = within(dialog()).getByRole('button', { name: 'Close drawer' })
    expect(closeX).toHaveAttribute('aria-disabled', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(closeX)
    fireEvent.click(screen.getByTestId('context-drawer-overlay'))
    expect(dialog()).toBeInTheDocument()

    pending.resolve(
      json(200, { results: [{ ...APP_1, status: 'deleted', filesDeleted: 3, failedCount: 0 }] }),
    )
    expect(await screen.findByText(/Deleted \(3 files\)/)).toBeInTheDocument()

    expect(closeX).not.toHaveAttribute('aria-disabled', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a server error shows an error summary with the message and takes focus', async () => {
    deleteResponse = json(500, {
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    })
    await goToConfirm()
    submitDelete()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('An unexpected error occurred.')
    await waitFor(() => expect(document.activeElement).toBe(alert))
    // Still on the confirm step, so the operator can try again.
    expect(screen.getByRole('heading', { name: 'Confirm deletion' })).toBeInTheDocument()
  })
})
