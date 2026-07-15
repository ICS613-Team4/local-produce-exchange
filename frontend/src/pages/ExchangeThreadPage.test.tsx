// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

// ── completed exchange locks the thread ────────────────────────────────────

function makeCompletedThread() {
  return {
    ...makeEmptyThread(),
    owner_id: 'owner-1',
    claimant_id: 'claimant-1',
    owner_name: 'Bob Baker',
    claimant_name: 'Carol Chen',
    claim_status: 'completed',
  }
}

test('a completed exchange shows the banner and disables the composer', async () => {
  window.localStorage.setItem('memberId', 'claimant-1')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeCompletedThread()))

  renderPage()

  // The banner names who completed it (always the poster). The completed-by
  // sentence is the banner's title line, styled like the other green infobox
  // titles, and the lock sentence sits under it as plain body text.
  const bannerTitle = await screen.findByText(
    'This exchange was marked complete by Bob Baker.',
  )
  expect(bannerTitle.className).toContain('font-medium')
  expect(bannerTitle.className).toContain('text-success')
  expect(
    screen.getByText('The thread is locked, so no new messages can be sent.'),
  ).toBeTruthy()

  // Locked: both the message box and the Send button are disabled.
  const textbox = screen.getByLabelText('Send a message') as HTMLTextAreaElement
  expect(textbox.disabled).toBe(true)
  const sendButton = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
  expect(sendButton.disabled).toBe(true)
})

test('the requester is offered a review of the poster', async () => {
  window.localStorage.setItem('memberId', 'claimant-1')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeCompletedThread()))

  renderPage()

  // The viewer is the requester, so the review target is the poster, by first
  // name, matching the completed rows on My Requests.
  expect(
    await screen.findByRole('button', { name: 'Leave a Review for Bob' }),
  ).toBeTruthy()
})

test('the poster is offered a review of the requester', async () => {
  window.localStorage.setItem('memberId', 'owner-1')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeCompletedThread()))

  renderPage()

  expect(
    await screen.findByRole('button', { name: 'Leave a Review for Carol' }),
  ).toBeTruthy()
})

// ── cancelled exchange locks the thread ────────────────────────────────────

function makeCancelledThread() {
  return {
    ...makeEmptyThread(),
    owner_id: 'owner-1',
    claimant_id: 'claimant-1',
    owner_name: 'Bob Baker',
    claimant_name: 'Carol Chen',
    claim_status: 'cancelled',
    approved_quantity: 3,
  }
}

test('a cancelled exchange shows the cancelled banner and disables the composer', async () => {
  window.localStorage.setItem('memberId', 'claimant-1')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeCancelledThread()))

  renderPage()

  // The claim carries an approved quantity, so the canceller is the requester,
  // named in the title line; the lock sentence sits under it as body text.
  const bannerTitle = await screen.findByText('This exchange was cancelled by Carol Chen.')
  expect(bannerTitle.className).toContain('font-medium')
  expect(
    screen.getByText('The thread is locked, so no new messages can be sent.'),
  ).toBeTruthy()

  const textbox = screen.getByLabelText('Send a message') as HTMLTextAreaElement
  expect(textbox.disabled).toBe(true)
  const sendButton = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
  expect(sendButton.disabled).toBe(true)

  // Nothing was exchanged, so there is nobody to review.
  expect(screen.queryByRole('button', { name: /Leave a Review/ })).toBeNull()
})

test('a request withdrawn before approval shows the plain cancelled title', async () => {
  window.localStorage.setItem('memberId', 'owner-1')
  const thread = { ...makeCancelledThread(), approved_quantity: null }
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, thread))

  renderPage()

  // Without an approved quantity the requester withdrew, so no name is given.
  expect(await screen.findByText('This exchange was cancelled.')).toBeTruthy()
  const textbox = screen.getByLabelText('Send a message') as HTMLTextAreaElement
  expect(textbox.disabled).toBe(true)
})

test('the review button shows the placeholder alert', async () => {
  window.localStorage.setItem('memberId', 'claimant-1')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeCompletedThread()))
  const alertSpy = vi.fn()
  vi.stubGlobal('alert', alertSpy)

  renderPage()

  const reviewButton = await screen.findByRole('button', { name: 'Leave a Review for Bob' })
  fireEvent.click(reviewButton)

  expect(alertSpy).toHaveBeenCalledTimes(1)
  expect(String(alertSpy.mock.calls[0][0])).toContain('US-20')
})

test('an exchange that is not completed keeps the composer open', async () => {
  window.localStorage.setItem('memberId', 'claimant-1')
  const thread = {
    ...makeEmptyThread(),
    owner_id: 'owner-1',
    claimant_id: 'claimant-1',
    owner_name: 'Bob Baker',
    claimant_name: 'Carol Chen',
    claim_status: 'approved',
  }
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, thread))

  renderPage()

  await waitFor(() => screen.getByLabelText('Send a message'))
  const textbox = screen.getByLabelText('Send a message') as HTMLTextAreaElement
  expect(textbox.disabled).toBe(false)
  const sendButton = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
  expect(sendButton.disabled).toBe(false)
  expect(screen.queryByText(/marked complete by/)).toBeNull()
  expect(screen.queryByRole('button', { name: /Leave a Review/ })).toBeNull()
})

// ── workflow buttons in the thread ─────────────────────────────────────────

function makeApprovedThread() {
  return {
    ...makeEmptyThread(),
    owner_id: 'owner-1',
    claimant_id: 'claimant-1',
    owner_name: 'Bob Baker',
    claimant_name: 'Carol Chen',
    claim_status: 'approved',
    approved_quantity: 2,
  }
}

function makePickedUpThread() {
  return { ...makeApprovedThread(), claim_status: 'picked_up' }
}

// A fetch stub for the action tests: the pickup or complete endpoint records
// its calls, and the thread GET answers with the before-thread until the
// action has happened, then with the after-thread, so the reload shows the
// next workflow state. Returns the list of recorded action URLs.
function stubActionFetch(before: object, after: object, actionPath: string) {
  const actionCalls: string[] = []
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes(actionPath)) {
      actionCalls.push(url)
      return makeFakeResponse(true, 200, { status: 'updated' })
    }
    if (actionCalls.length > 0) {
      return makeFakeResponse(true, 200, after)
    }
    return makeFakeResponse(true, 200, before)
  })
  return actionCalls
}

test('the requester sees Confirm the Pickup on an approved exchange', async () => {
  window.localStorage.setItem('memberId', 'claimant-1')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeApprovedThread()))

  renderPage()

  expect(await screen.findByRole('button', { name: 'Confirm the Pickup' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Mark exchange complete' })).toBeNull()
})

test('the poster sees no workflow button on an approved exchange', async () => {
  window.localStorage.setItem('memberId', 'owner-1')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeApprovedThread()))

  renderPage()

  await waitFor(() => screen.getByLabelText('Send a message'))
  expect(screen.queryByRole('button', { name: 'Confirm the Pickup' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Mark exchange complete' })).toBeNull()
})

test('Confirm the Pickup asks, calls the pickup endpoint, and reloads the thread', async () => {
  window.localStorage.setItem('memberId', 'claimant-1')
  const confirmSpy = vi.fn(() => true)
  vi.stubGlobal('confirm', confirmSpy)
  const actionCalls = stubActionFetch(makeApprovedThread(), makePickedUpThread(), '/pickup')

  renderPage()

  const pickupButton = await screen.findByRole('button', { name: 'Confirm the Pickup' })
  fireEvent.click(pickupButton)

  // The reloaded thread is picked up, so the requester's button goes away.
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'Confirm the Pickup' })).toBeNull()
  })
  expect(confirmSpy).toHaveBeenCalledWith(
    'Confirm that you picked up this item? This cannot be undone.',
  )
  expect(actionCalls.length).toBe(1)
  expect(actionCalls[0]).toBe('/api/claims/claim-1/pickup')
})

test('declining the pickup confirmation makes no request', async () => {
  window.localStorage.setItem('memberId', 'claimant-1')
  vi.stubGlobal('confirm', () => false)
  const actionCalls = stubActionFetch(makeApprovedThread(), makePickedUpThread(), '/pickup')

  renderPage()

  const pickupButton = await screen.findByRole('button', { name: 'Confirm the Pickup' })
  fireEvent.click(pickupButton)

  expect(await screen.findByRole('button', { name: 'Confirm the Pickup' })).toBeTruthy()
  expect(actionCalls.length).toBe(0)
})

test('a double click cannot fire the pickup call twice', async () => {
  window.localStorage.setItem('memberId', 'claimant-1')
  const confirmSpy = vi.fn(() => true)
  vi.stubGlobal('confirm', confirmSpy)

  // The pickup response hangs until released, keeping the call in flight
  // while the second click lands.
  let releasePickup: (value: FakeResponse) => void = () => {}
  const pickupPromise = new Promise<FakeResponse>((resolve) => {
    releasePickup = resolve
  })
  let pickupCallCount = 0
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('/pickup')) {
      pickupCallCount = pickupCallCount + 1
      return pickupPromise
    }
    if (pickupCallCount > 0) {
      return makeFakeResponse(true, 200, makePickedUpThread())
    }
    return makeFakeResponse(true, 200, makeApprovedThread())
  })

  renderPage()

  const pickupButton = await screen.findByRole('button', { name: 'Confirm the Pickup' })
  fireEvent.click(pickupButton)
  fireEvent.click(pickupButton)

  // Only the first click got through: one dialog, one call, and the button
  // stays disabled while the call runs.
  await waitFor(() => {
    const button = screen.getByRole('button', { name: 'Confirm the Pickup' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
  expect(confirmSpy).toHaveBeenCalledTimes(1)
  expect(pickupCallCount).toBe(1)

  await act(async () => {
    releasePickup(makeFakeResponse(true, 200, { status: 'picked_up' }))
  })
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'Confirm the Pickup' })).toBeNull()
  })
})

test('a failed pickup call shows the backend detail and keeps the button', async () => {
  window.localStorage.setItem('memberId', 'claimant-1')
  vi.stubGlobal('confirm', () => true)
  const alertSpy = vi.fn()
  vi.stubGlobal('alert', alertSpy)
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('/pickup')) {
      return makeFakeResponse(false, 409, {
        detail: 'This request is not approved, so pickup cannot be confirmed.',
      })
    }
    return makeFakeResponse(true, 200, makeApprovedThread())
  })

  renderPage()

  const pickupButton = await screen.findByRole('button', { name: 'Confirm the Pickup' })
  fireEvent.click(pickupButton)

  await waitFor(() => {
    expect(alertSpy).toHaveBeenCalledTimes(1)
  })
  expect(String(alertSpy.mock.calls[0][0])).toContain('not approved')
  const buttonAfter = screen.getByRole('button', { name: 'Confirm the Pickup' }) as HTMLButtonElement
  expect(buttonAfter.disabled).toBe(false)
})

test('a network failure on pickup shows the request error', async () => {
  window.localStorage.setItem('memberId', 'claimant-1')
  vi.stubGlobal('confirm', () => true)
  const alertSpy = vi.fn()
  vi.stubGlobal('alert', alertSpy)
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('/pickup')) {
      throw new Error('network down')
    }
    return makeFakeResponse(true, 200, makeApprovedThread())
  })

  renderPage()

  const pickupButton = await screen.findByRole('button', { name: 'Confirm the Pickup' })
  fireEvent.click(pickupButton)

  await waitFor(() => {
    expect(alertSpy).toHaveBeenCalledTimes(1)
  })
  expect(String(alertSpy.mock.calls[0][0])).toContain('Request failed')
})

test('the poster sees Mark exchange complete on a picked-up exchange', async () => {
  window.localStorage.setItem('memberId', 'owner-1')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makePickedUpThread()))

  renderPage()

  expect(await screen.findByRole('button', { name: 'Mark exchange complete' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Confirm the Pickup' })).toBeNull()
})

test('the requester sees no workflow button on a picked-up exchange', async () => {
  window.localStorage.setItem('memberId', 'claimant-1')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makePickedUpThread()))

  renderPage()

  await waitFor(() => screen.getByLabelText('Send a message'))
  expect(screen.queryByRole('button', { name: 'Mark exchange complete' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Confirm the Pickup' })).toBeNull()
})

test('Mark exchange complete asks, calls the complete endpoint, and locks the thread', async () => {
  window.localStorage.setItem('memberId', 'owner-1')
  const confirmSpy = vi.fn(() => true)
  vi.stubGlobal('confirm', confirmSpy)
  const completedThread = { ...makePickedUpThread(), claim_status: 'completed' }
  const actionCalls = stubActionFetch(makePickedUpThread(), completedThread, '/complete')

  renderPage()

  const completeButton = await screen.findByRole('button', { name: 'Mark exchange complete' })
  fireEvent.click(completeButton)

  // The reload shows the completed banner, the poster is offered the
  // requester's review, and the composer is locked.
  expect(
    await screen.findByText('This exchange was marked complete by Bob Baker.'),
  ).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Leave a Review for Carol' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Mark exchange complete' })).toBeNull()
  expect(confirmSpy).toHaveBeenCalledWith('Mark this exchange complete? This is final.')
  expect(actionCalls.length).toBe(1)
  expect(actionCalls[0]).toBe('/api/claims/claim-1/complete')
  const sendButton = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement
  expect(sendButton.disabled).toBe(true)
})

test('a failed complete call falls back to the plain error message', async () => {
  window.localStorage.setItem('memberId', 'owner-1')
  vi.stubGlobal('confirm', () => true)
  const alertSpy = vi.fn()
  vi.stubGlobal('alert', alertSpy)
  // The failure body is plain text, not JSON, so the handler falls back to
  // its generic message.
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('/complete')) {
      return { ok: false, status: 500, text: async () => 'boom' }
    }
    return makeFakeResponse(true, 200, makePickedUpThread())
  })

  renderPage()

  const completeButton = await screen.findByRole('button', { name: 'Mark exchange complete' })
  fireEvent.click(completeButton)

  await waitFor(() => {
    expect(alertSpy).toHaveBeenCalledTimes(1)
  })
  expect(String(alertSpy.mock.calls[0][0])).toContain('Could not complete the exchange')
  const buttonAfter = screen.getByRole('button', { name: 'Mark exchange complete' }) as HTMLButtonElement
  expect(buttonAfter.disabled).toBe(false)
})

test('a network failure on complete shows the request error', async () => {
  window.localStorage.setItem('memberId', 'owner-1')
  vi.stubGlobal('confirm', () => true)
  const alertSpy = vi.fn()
  vi.stubGlobal('alert', alertSpy)
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('/complete')) {
      throw new Error('network down')
    }
    return makeFakeResponse(true, 200, makePickedUpThread())
  })

  renderPage()

  const completeButton = await screen.findByRole('button', { name: 'Mark exchange complete' })
  fireEvent.click(completeButton)

  await waitFor(() => {
    expect(alertSpy).toHaveBeenCalledTimes(1)
  })
  expect(String(alertSpy.mock.calls[0][0])).toContain('Request failed')
})
