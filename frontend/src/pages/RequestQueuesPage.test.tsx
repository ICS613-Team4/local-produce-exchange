// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import RequestQueuesPage from './RequestQueuesPage'

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

// Builds a fake fetch result. body is JSON-encoded into the text() the service reads.
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

// A response body with one listing group holding two pending rows, the older
// (Bob) first and the newer (Carol) second.
function makeQueuesBody() {
  const body = {
    groups: [
      {
        listing_id: 'lemons',
        listing_title: 'Backyard Meyer Lemons',
        listing_status: 'active',
        remaining_quantity: 24,
        pending: [
          {
            id: 'c1',
            claimant_id: 'bob',
            claimant_name: 'Bob Baker',
            requested_quantity: 3,
            requested_at: '2026-07-01T09:00:00.000Z',
          },
          {
            id: 'c2',
            claimant_id: 'carol',
            claimant_name: 'Carol Chen',
            requested_quantity: 2,
            requested_at: '2026-07-01T10:00:00.000Z',
          },
        ],
      },
    ],
  }
  return body
}

// A response body with a single group whose listing id and title are supplied,
// used for the filter-change stale-response test.
function makeOneGroupBody(listingId: string, title: string) {
  const body = {
    groups: [
      {
        listing_id: listingId,
        listing_title: title,
        listing_status: 'active',
        remaining_quantity: 5,
        pending: [
          {
            id: listingId + '-claim',
            claimant_id: 'someone',
            claimant_name: 'Someone',
            requested_quantity: 1,
            requested_at: '2026-07-01T09:00:00.000Z',
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

test('renders the grouped queue with names, quantities, and remaining quantity', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeQueuesBody())
  })

  renderRequestsPage('/requests')

  expect(await screen.findByText('Backyard Meyer Lemons')).toBeTruthy()
  expect(screen.getByText('Remaining quantity: 24')).toBeTruthy()
  expect(screen.getByText(/Bob Baker requested 3/)).toBeTruthy()
  expect(screen.getByText(/Carol Chen requested 2/)).toBeTruthy()
  // The local time-zone note shows under the queue.
  expect(screen.getByText(/All times are shown in your local time zone/)).toBeTruthy()
})

test('shows the pending rows oldest-first', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeQueuesBody())
  })

  renderRequestsPage('/requests')

  expect(await screen.findByText(/Bob Baker requested 3/)).toBeTruthy()
  const rows = screen.getAllByRole('listitem')
  // Bob's older request renders before Carol's newer one.
  expect(rows[0].textContent).toContain('Bob Baker')
  expect(rows[1].textContent).toContain('Carol Chen')
})

test('marks a deactivated listing group with a suffix', async () => {
  setLoggedIn()
  const body = makeQueuesBody()
  body.groups[0].listing_status = 'deactivated'
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderRequestsPage('/requests')

  expect(await screen.findByText('Backyard Meyer Lemons (deactivated)')).toBeTruthy()
})

test('shows the global empty message when nothing is pending', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, { groups: [] })
  })

  renderRequestsPage('/requests')

  expect(
    await screen.findByText('You have no pending requests on any of your listings.'),
  ).toBeTruthy()
})

test('the filtered view shows only the matching listing group', async () => {
  setLoggedIn()
  let requestUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    requestUrl = String(url)
    return makeFakeResponse(true, 200, makeQueuesBody())
  })

  renderRequestsPage('/requests?listing=lemons')

  expect(await screen.findByText('Backyard Meyer Lemons')).toBeTruthy()
  expect(screen.getByText(/Bob Baker requested 3/)).toBeTruthy()
  // The page passed the filter to the backend so it can check ownership.
  expect(requestUrl).toBe('/api/request-queues?listing=lemons')
})

test('the filtered view shows the per-listing empty message when none pending', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, { groups: [] })
  })

  renderRequestsPage('/requests?listing=lemons')

  expect(await screen.findByText('No pending requests on this listing yet.')).toBeTruthy()
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
  // No queue rows leak.
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
