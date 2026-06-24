// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import DashboardPage from './DashboardPage'

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

// The dashboard now makes two fetches: the listings preview to /api/listings and
// the latest-requests widget to /api/request-queues. This routes each call to
// its own handler so a test can shape both.
function stubDashboardFetch(
  handleListings: (urlText: string, options: RequestInit) => FakeResponse,
  handleQueue: (urlText: string, options: RequestInit) => FakeResponse,
) {
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    const urlText = String(url)
    let usableOptions: RequestInit = {}
    if (options !== undefined) {
      usableOptions = options
    }
    if (urlText.includes('/api/request-queues')) {
      return handleQueue(urlText, usableOptions)
    }
    return handleListings(urlText, usableOptions)
  })
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

async function waitForStateUpdates() {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

// Renders the dashboard at /dashboard.
function renderDashboard() {
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

// A queue body with three pending requests across two listings, with distinct
// requested_at times so the newest-first order can be checked.
function makeThreeRequestQueueBody() {
  const body = {
    groups: [
      {
        listing_id: 'lemons',
        listing_title: 'Lemons',
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
            requested_at: '2026-07-01T11:00:00.000Z',
          },
        ],
      },
      {
        listing_id: 'squash',
        listing_title: 'Kabocha Squash',
        listing_status: 'active',
        remaining_quantity: 4,
        pending: [
          {
            id: 'c3',
            claimant_id: 'erin',
            claimant_name: 'Erin Vance',
            requested_quantity: 1,
            requested_at: '2026-07-01T10:00:00.000Z',
          },
        ],
      },
    ],
  }
  return body
}

// Collects the widget's request rows (the list items that read "X requested N on
// <listing> ..."), skipping the action links and preview items.
function getRequestRows() {
  const allItems = screen.getAllByRole('listitem')
  const requestRows = []
  for (let index = 0; index < allItems.length; index = index + 1) {
    const item = allItems[index]
    if (item.textContent !== null && item.textContent.includes('requested') && item.textContent.includes(' on ')) {
      requestRows.push(item)
    }
  }
  return requestRows
}

test('shows the title and the member action links', () => {
  renderDashboard()

  expect(screen.getByRole('heading', { name: 'Member Dashboard' })).toBeTruthy()

  const browseLink = screen.getByRole('link', { name: 'Browse All Listings' })
  expect(browseLink.getAttribute('href')).toBe('/browse')

  const createLink = screen.getByRole('link', { name: 'Create a Listing' })
  expect(createLink.getAttribute('href')).toBe('/listings/create')

  const inviteLink = screen.getByRole('link', { name: 'Invite a New Member' })
  expect(inviteLink.getAttribute('href')).toBe('/invite')

  const profileLink = screen.getByRole('link', { name: 'View Your Profile' })
  expect(profileLink.getAttribute('href')).toBe('/profile')

  // The two requests links live in this dashboard list now: incoming (requests on
  // your listings) and outgoing (requests you have made).
  const incomingRequestsLink = screen.getByRole('link', {
    name: 'See All Requests from Other Members',
  })
  expect(incomingRequestsLink.getAttribute('href')).toBe('/requests')

  const myRequestsLink = screen.getByRole('link', { name: 'See All Your Requests' })
  expect(myRequestsLink.getAttribute('href')).toBe('/my-requests')
})

test('shows the latest-listings preview for a logged-in member', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  let listingsUrl = ''
  let listingsOptions: RequestInit = {}
  stubDashboardFetch(
    (urlText, options) => {
      listingsUrl = urlText
      listingsOptions = options
      const listings = [
        {
          id: 'l1',
          owner_id: 'member-999',
          title: 'Backyard Meyer Lemons',
          description: 'Citrus.',
          category: 'Fruit',
          total_quantity: 5,
          remaining_quantity: 5,
          dietary_tags: [],
          allergen_tags: [],
          pickup_start: '2026-07-01T09:00:00.000Z',
          pickup_end: '2026-07-01T11:00:00.000Z',
          status: 'active',
          created_at: '2026-06-19T00:00:00.000Z',
        },
      ]
      return makeFakeResponse(true, 200, listings)
    },
    () => {
      return makeFakeResponse(true, 200, { groups: [] })
    },
  )

  renderDashboard()

  // The preview lists the latest titles, each linking to its detail page.
  const previewLink = await screen.findByRole('link', { name: 'Backyard Meyer Lemons' })
  expect(previewLink.getAttribute('href')).toBe('/listings/l1')

  // Each preview row shows the listing's posted time in parentheses, and the
  // local time-zone note shows under the preview.
  const timeZoneOptions = { timeZoneName: 'short' as const }
  const postedExpected = new Date('2026-06-19T00:00:00.000Z').toLocaleString(undefined, timeZoneOptions)
  const previewListItem = previewLink.closest('li')
  expect(previewListItem?.textContent).toContain('(' + postedExpected + ')')
  expect(screen.getByText(/All times are shown in your local time zone/)).toBeTruthy()

  // The preview asks for the five newest listings with the stored member id.
  expect(listingsUrl).toBe('/api/listings?limit=5')
  expect(JSON.stringify(listingsOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(listingsOptions.headers)).toContain('member-123')
})

test('does not request anything when logged out', () => {
  let fetchWasCalled = false
  vi.stubGlobal('fetch', async () => {
    fetchWasCalled = true
    return makeFakeResponse(true, 200, [])
  })

  renderDashboard()

  // No stored memberId, so both the preview and the widget requests are skipped.
  expect(fetchWasCalled).toBe(false)
})

test('shows the empty preview message when there are no listings', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  stubDashboardFetch(
    () => makeFakeResponse(true, 200, []),
    () => makeFakeResponse(true, 200, { groups: [] }),
  )

  renderDashboard()

  expect(await screen.findByText('No listings yet.')).toBeTruthy()
})

test('shows a transport error in the preview when the request times out', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  stubDashboardFetch(
    () => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    },
    () => makeFakeResponse(true, 200, { groups: [] }),
  )

  renderDashboard()

  expect(await screen.findByText(/Timeout: no answer from the backend/)).toBeTruthy()
})

test('shows an error in the preview on an HTTP failure', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  stubDashboardFetch(
    () => makeFakeResponse(false, 503, { detail: 'down' }),
    () => makeFakeResponse(true, 200, { groups: [] }),
  )

  renderDashboard()

  expect(await screen.findByText('Could not load the latest listings.')).toBeTruthy()
})

// --- US-10: the latest-requests widget ---

test('lists the latest requests newest-first in the widget', async () => {
  window.localStorage.setItem('memberId', 'dave')
  stubDashboardFetch(
    () => makeFakeResponse(true, 200, []),
    () => makeFakeResponse(true, 200, makeThreeRequestQueueBody()),
  )

  renderDashboard()

  // The newest request (Carol at 11:00) appears first across all listings.
  expect(await screen.findByText(/Carol Chen requested 2 on Lemons/)).toBeTruthy()
  const requestRows = getRequestRows()
  expect(requestRows.length).toBe(3)
  expect(requestRows[0].textContent).toContain('Carol Chen')
  expect(requestRows[1].textContent).toContain('Erin Vance')
  expect(requestRows[2].textContent).toContain('Bob Baker')
  // The local time-zone note shows under the request rows.
  expect(screen.getByText(/All times are shown in your local time zone/)).toBeTruthy()
})

test('caps the widget at the five newest requests', async () => {
  window.localStorage.setItem('memberId', 'dave')
  const pending = []
  for (let index = 0; index < 7; index = index + 1) {
    pending.push({
      id: 'c' + index,
      claimant_id: 'm' + index,
      claimant_name: 'Member ' + index,
      requested_quantity: 1,
      requested_at: '2026-07-0' + (index + 1) + 'T09:00:00.000Z',
    })
  }
  const queueBody = {
    groups: [
      {
        listing_id: 'lemons',
        listing_title: 'Lemons',
        listing_status: 'active',
        remaining_quantity: 24,
        pending: pending,
      },
    ],
  }
  stubDashboardFetch(
    () => makeFakeResponse(true, 200, []),
    () => makeFakeResponse(true, 200, queueBody),
  )

  renderDashboard()

  // The newest (Member 6, dated 2026-07-07) shows; only five rows render.
  expect(await screen.findByText(/Member 6 requested/)).toBeTruthy()
  const requestRows = getRequestRows()
  expect(requestRows.length).toBe(5)
})

test('shows the empty widget line when there are no pending requests', async () => {
  window.localStorage.setItem('memberId', 'dave')
  stubDashboardFetch(
    () => makeFakeResponse(true, 200, []),
    () => makeFakeResponse(true, 200, { groups: [] }),
  )

  renderDashboard()

  expect(await screen.findByText('No pending requests yet.')).toBeTruthy()
})

test('shows a See All Requests from Other Members link to the requests page', async () => {
  window.localStorage.setItem('memberId', 'dave')
  stubDashboardFetch(
    () => makeFakeResponse(true, 200, []),
    () => makeFakeResponse(true, 200, { groups: [] }),
  )

  renderDashboard()

  const link = await screen.findByRole('link', { name: 'See All Requests from Other Members' })
  expect(link.getAttribute('href')).toBe('/requests')
})

test('a widget 401 clears the credentials and fires the auth event', async () => {
  window.localStorage.setItem('memberId', 'stale')
  window.localStorage.setItem('memberName', 'Dave Diaz')
  window.localStorage.setItem('memberEmail', 'dave@example.com')

  let authEventFired = false
  function handleAuthEvent() {
    authEventFired = true
  }
  window.addEventListener('auth-state-changed', handleAuthEvent)

  stubDashboardFetch(
    () => makeFakeResponse(true, 200, []),
    () => makeFakeResponse(false, 401, { detail: 'Not authenticated.' }),
  )

  renderDashboard()

  await waitFor(() => {
    expect(window.localStorage.getItem('memberId')).toBeNull()
  })
  expect(window.localStorage.getItem('memberName')).toBeNull()
  expect(window.localStorage.getItem('memberEmail')).toBeNull()
  expect(authEventFired).toBe(true)

  window.removeEventListener('auth-state-changed', handleAuthEvent)
})

test('a widget fetch failure leaves the listings preview visible', async () => {
  window.localStorage.setItem('memberId', 'dave')
  const listings = [
    {
      id: 'l1',
      owner_id: 'member-999',
      title: 'Backyard Meyer Lemons',
      description: 'Citrus.',
      category: 'Fruit',
      total_quantity: 5,
      remaining_quantity: 5,
      dietary_tags: [],
      allergen_tags: [],
      pickup_start: '2026-07-01T09:00:00.000Z',
      pickup_end: '2026-07-01T11:00:00.000Z',
      status: 'active',
      created_at: '2026-06-19T00:00:00.000Z',
    },
  ]
  stubDashboardFetch(
    () => makeFakeResponse(true, 200, listings),
    () => makeFakeResponse(false, 503, { detail: 'down' }),
  )

  renderDashboard()

  // The preview still shows its listing even though the widget fetch failed.
  expect(await screen.findByRole('link', { name: 'Backyard Meyer Lemons' })).toBeTruthy()
  // The widget shows its own short error line.
  expect(screen.getByText('down')).toBeTruthy()
})

// A wrapper with a button that leaves the dashboard, so the late-response test
// can navigate away while the widget fetch is still in flight.
function DashboardWithLeaveButton() {
  const navigate = useNavigate()

  function handleLeave() {
    navigate('/elsewhere')
  }

  return (
    <>
      <button onClick={handleLeave}>leave</button>
      <DashboardPage />
    </>
  )
}

test('a late widget response after leaving the dashboard does not resurrect the widget', async () => {
  window.localStorage.setItem('memberId', 'dave')
  const pendingQueue = makePendingResponse()
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/api/request-queues')) {
      return pendingQueue.promise
    }
    return makeFakeResponse(true, 200, [])
  })

  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/dashboard" element={<DashboardWithLeaveButton />} />
        <Route path="/elsewhere" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  )

  // Leave the dashboard while the widget fetch is still pending.
  fireEvent.click(screen.getByRole('button', { name: 'leave' }))
  expect(await screen.findByText('elsewhere')).toBeTruthy()

  // The late response resolves after the dashboard is gone; it must not bring the
  // widget back or throw.
  pendingQueue.resolve(makeFakeResponse(true, 200, makeThreeRequestQueueBody()))
  await waitForStateUpdates()

  expect(screen.queryByText(/Carol Chen requested/)).toBeNull()
  expect(screen.getByText('elsewhere')).toBeTruthy()
})

test('shows a loading line while the widget request is in flight', async () => {
  window.localStorage.setItem('memberId', 'dave')
  const pendingQueue = makePendingResponse()
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/api/request-queues')) {
      return pendingQueue.promise
    }
    return makeFakeResponse(true, 200, [])
  })

  renderDashboard()

  expect(await screen.findByText('Loading latest requests...')).toBeTruthy()

  // Resolve so nothing dangles.
  pendingQueue.resolve(makeFakeResponse(true, 200, { groups: [] }))
  await waitForStateUpdates()
})

test('shows a transport error line in the widget when the queue request times out', async () => {
  window.localStorage.setItem('memberId', 'dave')
  stubDashboardFetch(
    () => makeFakeResponse(true, 200, []),
    () => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    },
  )

  renderDashboard()

  expect(await screen.findByText(/Timeout: no answer from the backend/)).toBeTruthy()
})

test('keeps both rows when two requests share the same timestamp', async () => {
  window.localStorage.setItem('memberId', 'dave')
  const queueBody = {
    groups: [
      {
        listing_id: 'lemons',
        listing_title: 'Lemons',
        listing_status: 'active',
        remaining_quantity: 5,
        pending: [
          {
            id: 'a',
            claimant_id: 'x',
            claimant_name: 'Ann',
            requested_quantity: 1,
            requested_at: '2026-07-01T09:00:00.000Z',
          },
          {
            id: 'b',
            claimant_id: 'y',
            claimant_name: 'Ben',
            requested_quantity: 1,
            requested_at: '2026-07-01T09:00:00.000Z',
          },
        ],
      },
    ],
  }
  stubDashboardFetch(
    () => makeFakeResponse(true, 200, []),
    () => makeFakeResponse(true, 200, queueBody),
  )

  renderDashboard()

  // Equal timestamps sort as equal, so both rows still render.
  expect(await screen.findByText(/Ann requested/)).toBeTruthy()
  const requestRows = getRequestRows()
  expect(requestRows.length).toBe(2)
})
