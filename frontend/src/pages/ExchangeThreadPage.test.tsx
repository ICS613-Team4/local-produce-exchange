// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import ExchangeThreadPage from './ExchangeThreadPage'

type FakeResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

function renderPage(search = '?claim=claim-1') {
  render(
    <MemoryRouter initialEntries={[`/exchange-thread${search}`]}>
      <Routes>
        <Route path="/exchange-thread" element={<ExchangeThreadPage />} />
        <Route path="/my-requests" element={<div>My Requests Page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function makeFakeResponse(ok: boolean, status: number, body: object): FakeResponse {
  return { ok, status, text: async () => JSON.stringify(body) }
}

function makeEmptyThread() {
  return { id: 'thread-1', claim_id: 'claim-1', created_at: '2026-06-28T10:00:00Z', messages: [] }
}

function makeThreadWithMessages() {
  return {
    id: 'thread-1',
    claim_id: 'claim-1',
    created_at: '2026-06-28T10:00:00Z',
    messages: [
      {
        id: 'msg-1',
        thread_id: 'thread-1',
        sender_id: 'member-1',
        sender_name: 'Alice',
        body: "I'll be there at 9am.",
        sent_at: '2026-06-28T10:01:00Z',
      },
      {
        id: 'msg-2',
        thread_id: 'thread-1',
        sender_id: 'member-2',
        sender_name: 'Bob',
        body: 'See you then!',
        sent_at: '2026-06-28T10:02:00Z',
      },
    ],
  }
}

// ── not logged in ──────────────────────────────────────────────────────────

test('shows not-logged-in message when memberId is absent', () => {
  renderPage()
  expect(screen.getByRole('alert').textContent).toContain('logged in')
})

// ── no claim param ─────────────────────────────────────────────────────────

test('shows error when no claim query param is present', () => {
  window.localStorage.setItem('memberId', 'member-1')
  renderPage('')
  expect(screen.getByRole('alert').textContent).toContain('No exchange specified')
})

// ── loading state ──────────────────────────────────────────────────────────

test('shows loading indicator while fetch is in flight', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  let resolve!: (r: FakeResponse) => void
  vi.stubGlobal('fetch', () => new Promise<FakeResponse>((res) => { resolve = res }))

  renderPage()

  expect(screen.getByText('Loading exchange thread...')).toBeTruthy()
  resolve(makeFakeResponse(true, 200, makeEmptyThread()))
})

// ── empty thread ───────────────────────────────────────────────────────────

test('shows empty-thread message and send form when thread has no messages', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeEmptyThread()))

  renderPage()

  await waitFor(() => screen.getByText('No messages yet. Start the conversation below.'))
  expect(screen.getByLabelText('Send a message')).toBeTruthy()
})

// ── messages rendered ──────────────────────────────────────────────────────

test('renders all messages with sender names and bodies', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeThreadWithMessages()))

  renderPage()

  await waitFor(() => screen.getByText("I'll be there at 9am."))
  expect(screen.getByText('Alice')).toBeTruthy()
  expect(screen.getByText('See you then!')).toBeTruthy()
  expect(screen.getByText('Bob')).toBeTruthy()
})

// ── send a message ─────────────────────────────────────────────────────────

test('sends message on form submit and reloads thread', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  const newMessage = {
    id: 'msg-3',
    thread_id: 'thread-1',
    sender_id: 'member-1',
    sender_name: 'Alice',
    body: 'Hello!',
    sent_at: '2026-06-28T10:05:00Z',
  }
  let callCount = 0
  vi.stubGlobal('fetch', async (_url: string, options: RequestInit | undefined) => {
    callCount = callCount + 1
    if (options?.method === 'POST') {
      return makeFakeResponse(true, 201, newMessage)
    }
    // First GET returns empty thread; second (after send) returns one message.
    if (callCount <= 1) {
      return makeFakeResponse(true, 200, makeEmptyThread())
    }
    return makeFakeResponse(true, 200, { ...makeEmptyThread(), messages: [newMessage] })
  })

  renderPage()
  await waitFor(() => screen.getByLabelText('Send a message'))

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello!' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))

  await waitFor(() => screen.getByText('Hello!'))
})

// ── send empty message shows error ────────────────────────────────────────

test('shows validation error when message body is empty', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeEmptyThread()))

  renderPage()
  await waitFor(() => screen.getByRole('button', { name: 'Send' }))

  fireEvent.click(screen.getByRole('button', { name: 'Send' }))

  expect(screen.getByRole('alert').textContent).toContain('empty')
})

// ── 403 access denied ─────────────────────────────────────────────────────

test('shows denied message when backend returns 403', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async () =>
    makeFakeResponse(false, 403, { detail: 'You are not a party to this exchange.' }),
  )

  renderPage()

  await waitFor(() => screen.getByRole('alert'))
  expect(screen.getByRole('alert').textContent).toContain('not a party')
})

// ── 401 clears session ────────────────────────────────────────────────────

test('clears localStorage and fires auth event on 401 response', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  window.localStorage.setItem('memberName', 'Alice')
  window.localStorage.setItem('memberEmail', 'alice@test.com')
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 401, { detail: 'Unauthorized' }))

  renderPage()

  await waitFor(() => expect(window.localStorage.getItem('memberId')).toBeNull())
  expect(window.localStorage.getItem('memberName')).toBeNull()
  expect(window.localStorage.getItem('memberEmail')).toBeNull()
})

// ── network error on load ─────────────────────────────────────────────────

test('shows load error when getThread returns a network error', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async () => {
    const err = new DOMException('timed out', 'TimeoutError')
    throw err
  })

  renderPage()

  await waitFor(() => screen.getByRole('alert'))
  expect(screen.getByRole('alert').textContent).toContain('Timeout')
})

// ── network error on send ─────────────────────────────────────────────────

test('shows send error when sendMessage returns a network error', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  let callCount = 0
  vi.stubGlobal('fetch', async () => {
    callCount += 1
    if (callCount === 1) return makeFakeResponse(true, 200, makeEmptyThread())
    const err = new DOMException('timed out', 'TimeoutError')
    throw err
  })

  renderPage()
  await waitFor(() => screen.getByRole('button', { name: 'Send' }))

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))

  await waitFor(() => screen.getByRole('alert'))
  expect(screen.getByRole('alert').textContent).toContain('Timeout')
})

// ── non-ok HTTP response on send ──────────────────────────────────────────

test('shows detail from non-ok send response', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  let callCount = 0
  vi.stubGlobal('fetch', async () => {
    callCount += 1
    if (callCount === 1) return makeFakeResponse(true, 200, makeEmptyThread())
    return makeFakeResponse(false, 500, { detail: 'Server blew up.' })
  })

  renderPage()
  await waitFor(() => screen.getByRole('button', { name: 'Send' }))

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))

  await waitFor(() => screen.getByRole('alert'))
  expect(screen.getByRole('alert').textContent).toContain('Server blew up.')
})

// ── listing summary card ──────────────────────────────────────────────────

test('shows the listing summary card with photo, poster, quantities, and pickup window', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  const thread = {
    ...makeEmptyThread(),
    listing_id: 'listing-9',
    listing_title: 'Backyard Meyer Lemons',
    owner_name: 'Dave Diaz',
    claimant_name: 'Alice Admin',
    listing_created_at: '2026-06-19T00:00:00.000Z',
    pickup_start: '2026-07-01T09:00:00.000Z',
    pickup_end: '2026-07-01T11:00:00.000Z',
    requested_quantity: 3,
    approved_quantity: 2,
    photos: [{ id: 'photo-1', content_type: 'image/png', position: 0 }],
  }
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, thread))

  renderPage()

  // The title links to the listing's detail page.
  const titleLink = await screen.findByRole('link', { name: 'Backyard Meyer Lemons' })
  expect(titleLink.getAttribute('href')).toBe('/listings/listing-9')
  // The cover photo renders from the public photo endpoint.
  const image = screen.getByRole('img', { name: 'Backyard Meyer Lemons' })
  expect(image.getAttribute('src')).toBe('/api/photos/photo-1')
  // The poster and posted time, in the viewer's zone.
  const timeZoneOptions = { timeZoneName: 'short' as const }
  const postedExpected = new Date('2026-06-19T00:00:00.000Z').toLocaleString(undefined, timeZoneOptions)
  expect(screen.getByText('Posted by Dave Diaz on ' + postedExpected)).toBeTruthy()
  // Who requested the items, on its own line under the poster.
  expect(screen.getByText('Requested by Alice Admin')).toBeTruthy()
  // The claim quantities and the pickup window.
  expect(screen.getByText('Requested:')).toBeTruthy()
  expect(screen.getByText('3')).toBeTruthy()
  expect(screen.getByText('Approved:')).toBeTruthy()
  expect(screen.getByText('2')).toBeTruthy()
  expect(screen.getByText('Pickup:')).toBeTruthy()
})

test('shows no listing summary card when the response has no listing fields', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeEmptyThread()))

  renderPage()

  await waitFor(() => screen.getByRole('heading', { name: 'Exchange Thread' }))
  expect(screen.queryByText(/Requested:/)).toBeNull()
  expect(screen.queryByRole('img')).toBeNull()
})

// ── back link ─────────────────────────────────────────────────────────────

test('renders no back link, since arrivals come from several pages', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeEmptyThread()))

  renderPage()

  await waitFor(() => screen.getByRole('heading', { name: 'Exchange Thread' }))
  expect(screen.queryByText(/Back to My Requests/)).toBeNull()
})

test('shows the poster instructions when the viewer owns the listing', async () => {
  window.localStorage.setItem('memberId', 'owner-1')
  const thread = { ...makeEmptyThread(), owner_id: 'owner-1', claimant_id: 'claimant-1' }
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, thread))

  renderPage()

  expect(await screen.findByText(/You posted this listing/)).toBeTruthy()
  expect(screen.queryByText(/You requested these items/)).toBeNull()
})

test('shows the requester instructions when the viewer made the claim', async () => {
  window.localStorage.setItem('memberId', 'claimant-1')
  const thread = { ...makeEmptyThread(), owner_id: 'owner-1', claimant_id: 'claimant-1' }
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, thread))

  renderPage()

  expect(await screen.findByText(/You requested these items/)).toBeTruthy()
  expect(screen.queryByText(/You posted this listing/)).toBeNull()
})

test('shows the generic instructions when the response has no party ids', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeEmptyThread()))

  renderPage()

  await waitFor(() => screen.getByRole('heading', { name: 'Exchange Thread' }))
  expect(screen.getByText(/between the poster and the requester/)).toBeTruthy()
})
