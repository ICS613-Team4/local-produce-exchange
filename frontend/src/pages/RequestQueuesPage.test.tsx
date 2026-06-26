// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import RequestQueuesPage from './RequestQueuesPage'
import type { AllRequestsResponse } from '../services/requestQueueService'

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

// Renders the requests page at the given path, so useSearchParams reads the
// optional ?listing filter the way the real app does.
function renderRequestsPage(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/requests" element={<RequestQueuesPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function makeFakeResponse(ok: boolean, status: number, body: object): FakeResponse {
  const bodyText = JSON.stringify(body)
  const fakeResponse = {
    ok: ok,
    status: status,
    text: async () => {
      return bodyText
    },
  }
  return fakeResponse
}

// A response body with one listing group holding two requests: Bob's pending
// (actionable) request and Carol's already-approved (read-only) request.
function makeAllRequestsBody(): AllRequestsResponse {
  const body = {
    groups: [
      {
        listing_id: 'lemons',
        listing_title: 'Backyard Meyer Lemons',
        remaining_quantity: 24,
        requests: [
          {
            id: 'c1',
            claimant_id: 'bob',
            claimant_name: 'Bob Baker',
            requested_quantity: 3,
            approved_quantity: null,
            status: 'requested',
            requested_at: '2026-07-01T09:00:00.000Z',
            approved_at: null,
            denied_at: null,
            can_decide: true,
            can_deny: true,
          },
          {
            id: 'c2',
            claimant_id: 'carol',
            claimant_name: 'Carol Chen',
            requested_quantity: 2,
            approved_quantity: 2,
            status: 'approved',
            requested_at: '2026-07-01T10:00:00.000Z',
            approved_at: '2026-07-02T10:00:00.000Z',
            denied_at: null,
            can_decide: false,
            can_deny: false,
          },
        ],
      },
    ],
  }
  return body
}

// A single-group body whose listing id and title are supplied, used for the
// filter-change stale-response test.
function makeOneGroupBody(listingId: string, title: string) {
  const body = {
    groups: [
      {
        listing_id: listingId,
        listing_title: title,
        remaining_quantity: 5,
        requests: [
          {
            id: listingId + '-c',
            claimant_id: 'someone',
            claimant_name: 'Someone',
            requested_quantity: 1,
            approved_quantity: null,
            status: 'requested',
            requested_at: '2026-07-01T09:00:00.000Z',
            approved_at: null,
            denied_at: null,
            can_decide: false,
            can_deny: false,
          },
        ],
      },
    ],
  }
  return body
}

function makePendingResponse() {
  let resolveResponse: (response: FakeResponse) => void = () => {}
  const responsePromise = new Promise<FakeResponse>((resolve) => {
    resolveResponse = resolve
  })
  const pendingResponse = {
    promise: responsePromise,
    resolve: resolveResponse,
  }
  return pendingResponse
}

function setLoggedIn() {
  window.localStorage.setItem('memberId', 'dave')
  window.localStorage.setItem('memberName', 'Dave Diaz')
  window.localStorage.setItem('memberEmail', 'dave@example.com')
}

async function waitForStateUpdates() {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

// A wrapper with a button that navigates to a different ?listing filter, so the
// stale-response test can change the filter mid-flight.
function RequestsPageWithFilterButton() {
  const navigate = useNavigate()

  function handleClick() {
    navigate('/requests?listing=second')
  }

  return (
    <>
      <button onClick={handleClick}>go second</button>
      <RequestQueuesPage />
    </>
  )
}

test('renders the group with every request status in the backend order', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeAllRequestsBody())
  })

  renderRequestsPage('/requests')

  expect(await screen.findByText('Backyard Meyer Lemons')).toBeTruthy()
  expect(screen.getByText('Your Remaining Quantity: 24')).toBeTruthy()
  expect(screen.getByText(/Bob Baker requested 3/)).toBeTruthy()
  expect(screen.getByText(/Carol Chen requested 2/)).toBeTruthy()
  // Bob's pending status and Carol's approved outcome both show.
  expect(screen.getByText('Status: requested')).toBeTruthy()
  expect(screen.getByText(/Approved: 2 on/)).toBeTruthy()

  // Bob's row comes before Carol's, the order the backend returned.
  const bobRow = screen.getByText(/Bob Baker requested 3/)
  const carolRow = screen.getByText(/Carol Chen requested 2/)
  const relativePosition = bobRow.compareDocumentPosition(carolRow)
  expect(relativePosition & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
})

test('an actionable request shows Approve/Deny and a click reloads with the new status', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  let getCalls = 0
  let decideUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    const urlText = String(url)
    let method = 'GET'
    if (options !== undefined && options.method !== undefined) {
      method = String(options.method)
    }
    if (method === 'PATCH') {
      decideUrl = urlText
      return makeFakeResponse(true, 200, {
        id: 'c1',
        status: 'approved',
        approved_quantity: 3,
        approved_at: '2026-07-02T10:00:00.000Z',
      })
    }
    getCalls = getCalls + 1
    if (getCalls === 1) {
      return makeFakeResponse(true, 200, makeAllRequestsBody())
    }
    // After the reload, Bob's request is approved and no longer actionable.
    const reloaded = makeAllRequestsBody()
    reloaded.groups[0].requests[0].status = 'approved'
    reloaded.groups[0].requests[0].approved_quantity = 3
    reloaded.groups[0].requests[0].approved_at = '2026-07-02T10:00:00.000Z'
    reloaded.groups[0].requests[0].can_decide = false
    reloaded.groups[0].requests[0].can_deny = false
    return makeFakeResponse(true, 200, reloaded)
  })

  renderRequestsPage('/requests')

  const approveButton = await screen.findByRole('button', { name: 'Approve this request' })
  fireEvent.click(approveButton)

  // After the reload there are no actionable rows, so the button is gone.
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'Approve this request' })).toBeNull()
  })
  expect(decideUrl).toContain('/api/claims/c1/approve')
  expect(getCalls).toBe(2)
})

test('denying an actionable request sends a PATCH to the deny path', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  let decideUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    const urlText = String(url)
    let method = 'GET'
    if (options !== undefined && options.method !== undefined) {
      method = String(options.method)
    }
    if (method === 'PATCH') {
      decideUrl = urlText
      return makeFakeResponse(true, 200, {
        id: 'c1',
        status: 'denied',
        denied_at: '2026-07-02T10:00:00.000Z',
      })
    }
    return makeFakeResponse(true, 200, makeAllRequestsBody())
  })

  renderRequestsPage('/requests')

  const denyButton = await screen.findByRole('button', { name: 'Deny this request' })
  fireEvent.click(denyButton)
  await waitForStateUpdates()

  expect(decideUrl).toContain('/api/claims/c1/deny')
})

test('a non-actionable request shows its status read-only with no buttons', async () => {
  setLoggedIn()
  const body = makeAllRequestsBody()
  // Make Bob's request non-actionable too, so the whole group is read-only.
  body.groups[0].requests[0].can_decide = false
  body.groups[0].requests[0].can_deny = false
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderRequestsPage('/requests')

  expect(await screen.findByText(/Carol Chen requested 2/)).toBeTruthy()
  expect(screen.getByText(/Approved: 2 on/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Approve this request' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Deny this request' })).toBeNull()
})

test('an exhausted listing still shows Deny (not Approve) on a pending request', async () => {
  // The bug fix: with no remaining quantity the backend sends can_decide false
  // and can_deny true, so only the Deny button shows on the still-pending request.
  setLoggedIn()
  const body = makeAllRequestsBody()
  body.groups[0].requests[0].can_decide = false
  body.groups[0].requests[0].can_deny = true
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderRequestsPage('/requests')

  expect(await screen.findByText(/Bob Baker requested 3/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Approve this request' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Deny this request' })).toBeTruthy()
})

test('cancelling the confirm does not send a decision', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return false
  })
  let patchCount = 0
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    let method = 'GET'
    if (options !== undefined && options.method !== undefined) {
      method = String(options.method)
    }
    if (method === 'PATCH') {
      patchCount = patchCount + 1
      return makeFakeResponse(true, 200, {})
    }
    return makeFakeResponse(true, 200, makeAllRequestsBody())
  })

  renderRequestsPage('/requests')

  const approveButton = await screen.findByRole('button', { name: 'Approve this request' })
  fireEvent.click(approveButton)
  await waitForStateUpdates()

  expect(patchCount).toBe(0)
  expect(screen.getByRole('button', { name: 'Approve this request' })).toBeTruthy()
})

test('shows the global empty state when there are no active listings', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, { groups: [] })
  })

  renderRequestsPage('/requests')

  expect(await screen.findByText('You have no active listings.')).toBeTruthy()
})

test('shows the per-listing empty note when a listing has no requests', async () => {
  setLoggedIn()
  const body = {
    groups: [
      {
        listing_id: 'lemons',
        listing_title: 'Lemons',
        remaining_quantity: 5,
        requests: [],
      },
    ],
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderRequestsPage('/requests')

  expect(await screen.findByText('Lemons')).toBeTruthy()
  expect(screen.getByText('No requests on this listing yet.')).toBeTruthy()
})

test('the filtered view requests the all-requests endpoint with the listing filter', async () => {
  setLoggedIn()
  let requestUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    requestUrl = String(url)
    const body = {
      groups: [
        {
          listing_id: 'lemons',
          listing_title: 'Lemons',
          remaining_quantity: 5,
          requests: [],
        },
      ],
    }
    return makeFakeResponse(true, 200, body)
  })

  renderRequestsPage('/requests?listing=lemons')

  expect(await screen.findByText('Lemons')).toBeTruthy()
  expect(requestUrl).toBe('/api/request-queues/all?listing=lemons')
})

test('the filtered view shows the no-group empty message when the listing is not returned', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, { groups: [] })
  })

  renderRequestsPage('/requests?listing=lemons')

  expect(await screen.findByText('No active listing found for this filter.')).toBeTruthy()
})

test('shows the 403 detail for a foreign listing and renders no rows', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 403, {
      detail: 'You can only view requests for your own listings.',
    })
  })

  renderRequestsPage('/requests?listing=lemons')

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('You can only view requests for your own listings.')
  expect(screen.queryByRole('listitem')).toBeNull()
})

test('a stale-session 401 clears the credentials and fires the auth event', async () => {
  window.localStorage.setItem('memberId', 'stale-id')
  window.localStorage.setItem('memberName', 'Dave Diaz')
  window.localStorage.setItem('memberEmail', 'dave@example.com')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 401, { detail: 'Not authenticated. Unknown member.' })
  })

  let authEventFired = false
  function handleAuthEvent() {
    authEventFired = true
  }
  window.addEventListener('auth-state-changed', handleAuthEvent)

  renderRequestsPage('/requests')

  expect(await screen.findByText('You need to be logged in to see this page.')).toBeTruthy()
  expect(window.localStorage.getItem('memberId')).toBeNull()
  expect(window.localStorage.getItem('memberName')).toBeNull()
  expect(window.localStorage.getItem('memberEmail')).toBeNull()
  expect(authEventFired).toBe(true)

  window.removeEventListener('auth-state-changed', handleAuthEvent)
})

test('shows the server detail on a non-200 failure', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 503, { detail: 'Could not read your requests right now.' })
  })

  renderRequestsPage('/requests')

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Could not read your requests right now.')
})

test('shows the transport error message when the request fails', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  renderRequestsPage('/requests')

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Timeout')
})

test('shows the fallback message on a non-200 failure that carries no detail', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 500, {})
  })

  renderRequestsPage('/requests')

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Could not load your requests. Please try again.')
})

test('renders the not-logged-in message and does not fetch when logged out', async () => {
  let fetchCallCount = 0
  vi.stubGlobal('fetch', async () => {
    fetchCallCount = fetchCallCount + 1
    return makeFakeResponse(true, 200, { groups: [] })
  })

  renderRequestsPage('/requests')

  expect(screen.getByText('You need to be logged in to see this page.')).toBeTruthy()
  await waitForStateUpdates()
  expect(fetchCallCount).toBe(0)
})

test('drops a late response after the listing filter changes', async () => {
  setLoggedIn()
  const firstResponse = makePendingResponse()
  const secondResponse = makePendingResponse()
  let fetchCallCount = 0

  vi.stubGlobal('fetch', async () => {
    fetchCallCount = fetchCallCount + 1
    if (fetchCallCount === 1) {
      return firstResponse.promise
    }
    if (fetchCallCount === 2) {
      return secondResponse.promise
    }
    throw new Error('Unexpected fetch')
  })

  render(
    <MemoryRouter initialEntries={['/requests?listing=first']}>
      <Routes>
        <Route path="/requests" element={<RequestsPageWithFilterButton />} />
      </Routes>
    </MemoryRouter>,
  )

  // Change the filter while the first load is still in flight.
  fireEvent.click(screen.getByRole('button', { name: 'go second' }))

  secondResponse.resolve(makeFakeResponse(true, 200, makeOneGroupBody('second', 'Second Listing')))
  expect(await screen.findByText('Second Listing')).toBeTruthy()

  // The stale first response resolves last and must be dropped.
  firstResponse.resolve(makeFakeResponse(true, 200, makeOneGroupBody('first', 'First Listing')))
  await waitForStateUpdates()

  expect(screen.getByText('Second Listing')).toBeTruthy()
  expect(screen.queryByText('First Listing')).toBeNull()
})

test('a failed decision shows the server message and keeps the buttons', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  let alertMessage = ''
  vi.stubGlobal('alert', (message: string) => {
    alertMessage = message
  })
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    let method = 'GET'
    if (options !== undefined && options.method !== undefined) {
      method = String(options.method)
    }
    if (method === 'PATCH') {
      return makeFakeResponse(false, 409, {
        detail: 'This request is not pending, so it cannot be approved.',
      })
    }
    return makeFakeResponse(true, 200, makeAllRequestsBody())
  })

  renderRequestsPage('/requests')

  const approveButton = await screen.findByRole('button', { name: 'Approve this request' })
  fireEvent.click(approveButton)
  await waitForStateUpdates()

  expect(alertMessage).toContain('not pending')
  // The buttons stay so the owner can retry.
  expect(screen.getByRole('button', { name: 'Approve this request' })).toBeTruthy()
})

test('a transport failure on a decision shows the transport message via an alert', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  let alertMessage = ''
  vi.stubGlobal('alert', (message: string) => {
    alertMessage = message
  })
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    let method = 'GET'
    if (options !== undefined && options.method !== undefined) {
      method = String(options.method)
    }
    if (method === 'PATCH') {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    }
    return makeFakeResponse(true, 200, makeAllRequestsBody())
  })

  renderRequestsPage('/requests')

  const approveButton = await screen.findByRole('button', { name: 'Approve this request' })
  fireEvent.click(approveButton)
  await waitForStateUpdates()

  expect(alertMessage).toContain('Timeout')
})

test('shows a denied status outcome for a denied request', async () => {
  setLoggedIn()
  const body = makeAllRequestsBody()
  // Turn Carol's row into a denied request, which is read-only.
  body.groups[0].requests[1].status = 'denied'
  body.groups[0].requests[1].approved_quantity = null
  body.groups[0].requests[1].approved_at = null
  body.groups[0].requests[1].denied_at = '2026-07-02T10:00:00.000Z'
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderRequestsPage('/requests')

  expect(await screen.findByText(/Denied on/)).toBeTruthy()
})
