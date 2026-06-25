// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
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

// One listing body in the shape the listing endpoints return.
function makeListing(id: string, title: string, status: string) {
  const listing = {
    id: id,
    owner_id: 'me',
    title: title,
    description: 'A description.',
    category: 'Fruit',
    total_quantity: 5,
    remaining_quantity: 5,
    dietary_tags: [],
    allergen_tags: [],
    pickup_start: '2026-07-01T09:00:00.000Z',
    pickup_end: '2026-07-01T11:00:00.000Z',
    status: status,
    created_at: '2026-06-19T00:00:00.000Z',
    deactivated_by: null,
  }
  return listing
}

// The dashboard now loads four endpoints on mount: the listings preview
// (/api/listings), the caller's listings (/api/my-listings), the incoming queue
// (/api/request-queues), and the outgoing requests (/api/my-requests). It also
// PATCHes /api/claims/<id>/approve|deny|withdraw on a button click. This installs
// one fetch stub that routes by URL and method, so a test overrides only the
// pieces it cares about and the rest answer with empty, valid bodies.
type DashboardHandlers = {
  listings?: (urlText: string, options: RequestInit) => FakeResponse
  myListings?: () => FakeResponse
  incoming?: () => FakeResponse
  myRequests?: () => FakeResponse
  decide?: (urlText: string) => FakeResponse
  withdraw?: (urlText: string) => FakeResponse
}

function installDashboardFetch(handlers: DashboardHandlers) {
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    const urlText = String(url)
    let method = 'GET'
    if (options !== undefined && options.method !== undefined) {
      method = String(options.method)
    }
    let usableOptions: RequestInit = {}
    if (options !== undefined) {
      usableOptions = options
    }

    if (method === 'PATCH' && urlText.includes('/api/claims/')) {
      if (urlText.includes('/withdraw')) {
        if (handlers.withdraw !== undefined) {
          return handlers.withdraw(urlText)
        }
        return makeFakeResponse(true, 200, { id: 'c', status: 'cancelled' })
      }
      if (handlers.decide !== undefined) {
        return handlers.decide(urlText)
      }
      return makeFakeResponse(true, 200, { id: 'c', status: 'approved', approved_quantity: 1 })
    }
    if (urlText.includes('/api/my-listings')) {
      if (handlers.myListings !== undefined) {
        return handlers.myListings()
      }
      return makeFakeResponse(true, 200, [])
    }
    if (urlText.includes('/api/request-queues')) {
      if (handlers.incoming !== undefined) {
        return handlers.incoming()
      }
      return makeFakeResponse(true, 200, { groups: [] })
    }
    if (urlText.includes('/api/my-requests')) {
      if (handlers.myRequests !== undefined) {
        return handlers.myRequests()
      }
      return makeFakeResponse(true, 200, { pending: [], approved: [], denied: [] })
    }
    // Default: the listings preview at /api/listings.
    if (handlers.listings !== undefined) {
      return handlers.listings(urlText, usableOptions)
    }
    return makeFakeResponse(true, 200, [])
  })
}

function renderDashboard() {
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function setLoggedIn() {
  window.localStorage.setItem('memberId', 'me')
}

async function waitForStateUpdates() {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

test('shows the title and the member action links', () => {
  renderDashboard()

  expect(screen.getByRole('heading', { name: 'Member Dashboard' })).toBeTruthy()

  const browseLink = screen.getByRole('link', { name: 'Browse All Listings' })
  expect(browseLink.getAttribute('href')).toBe('/browse')

  const createLink = screen.getByRole('link', { name: 'Create a Listing' })
  expect(createLink.getAttribute('href')).toBe('/listings/create')

  // The new nav link to the My Listings page.
  const myListingsLink = screen.getByRole('link', { name: 'See All My Listings' })
  expect(myListingsLink.getAttribute('href')).toBe('/my-listings')

  const inviteLink = screen.getByRole('link', { name: 'Invite a New Member' })
  expect(inviteLink.getAttribute('href')).toBe('/invite')

  const profileLink = screen.getByRole('link', { name: 'View Your Profile' })
  expect(profileLink.getAttribute('href')).toBe('/profile')

  const incomingRequestsLink = screen.getByRole('link', {
    name: 'See All Incoming Requests',
  })
  expect(incomingRequestsLink.getAttribute('href')).toBe('/requests')

  const myRequestsLink = screen.getByRole('link', { name: 'See My Requests to Other Members' })
  expect(myRequestsLink.getAttribute('href')).toBe('/my-requests')
})

test('shows the latest-listings preview for a logged-in member', async () => {
  setLoggedIn()
  let listingsUrl = ''
  let listingsOptions: RequestInit = {}
  installDashboardFetch({
    listings: (urlText, options) => {
      listingsUrl = urlText
      listingsOptions = options
      const listings = [makeListing('l1', 'Backyard Meyer Lemons', 'active')]
      return makeFakeResponse(true, 200, listings)
    },
  })

  renderDashboard()

  const previewLink = await screen.findByRole('link', { name: 'Backyard Meyer Lemons' })
  expect(previewLink.getAttribute('href')).toBe('/listings/l1')

  const timeZoneOptions = { timeZoneName: 'short' as const }
  const postedExpected = new Date('2026-06-19T00:00:00.000Z').toLocaleString(undefined, timeZoneOptions)
  const previewListItem = previewLink.closest('li')
  expect(previewListItem?.textContent).toContain('(posted on: ' + postedExpected + ')')

  // The preview asks for the five newest listings with the stored member id.
  expect(listingsUrl).toBe('/api/listings?limit=5')
  expect(JSON.stringify(listingsOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(listingsOptions.headers)).toContain('me')
})

test('does not request anything when logged out', () => {
  let fetchWasCalled = false
  vi.stubGlobal('fetch', async () => {
    fetchWasCalled = true
    return makeFakeResponse(true, 200, [])
  })

  renderDashboard()

  // No stored memberId, so every section's request is skipped.
  expect(fetchWasCalled).toBe(false)
})

test('shows the empty preview message when there are no listings', async () => {
  setLoggedIn()
  installDashboardFetch({ listings: () => makeFakeResponse(true, 200, []) })

  renderDashboard()

  expect(await screen.findByText('No listings yet.')).toBeTruthy()
})

test('shows a transport error in the preview when the request times out', async () => {
  setLoggedIn()
  // Only the preview fetch fails; the other sections answer with empty bodies so
  // the timeout message appears once, on the preview.
  installDashboardFetch({
    listings: () => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    },
  })

  renderDashboard()

  expect(await screen.findByText(/Timeout: no answer from the backend/)).toBeTruthy()
})

test('shows an error in the preview on an HTTP failure', async () => {
  setLoggedIn()
  installDashboardFetch({ listings: () => makeFakeResponse(false, 503, { detail: 'down' }) })

  renderDashboard()

  expect(await screen.findByText('Could not load the latest listings.')).toBeTruthy()
})

// --- US-24: My Active Listings section ---

test('My Active Listings shows only active listings in the returned order', async () => {
  setLoggedIn()
  installDashboardFetch({
    myListings: () =>
      makeFakeResponse(true, 200, [
        makeListing('a', 'Active One', 'active'),
        makeListing('b', 'Down One', 'deactivated'),
        makeListing('c', 'Active Two', 'active'),
      ]),
  })

  renderDashboard()

  expect(await screen.findByRole('link', { name: 'Active One' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Active Two' })).toBeTruthy()
  // The deactivated listing is not shown in this active-only section.
  expect(screen.queryByText(/Down One/)).toBeNull()
})

test('My Active Listings shows its empty state when there are no active listings', async () => {
  setLoggedIn()
  installDashboardFetch({ myListings: () => makeFakeResponse(true, 200, []) })

  renderDashboard()

  expect(await screen.findByText('You have no active listings.')).toBeTruthy()
})

// --- US-24: Incoming requests section ---

function makeIncomingGroup(canDecide: boolean) {
  const group = {
    groups: [
      {
        listing_id: 'lemons',
        listing_title: 'Lemons',
        listing_status: 'active',
        remaining_quantity: 5,
        pending: [
          {
            id: 'c1',
            claimant_id: 'bob',
            claimant_name: 'Bob',
            requested_quantity: 2,
            requested_at: '2026-07-01T09:00:00.000Z',
            can_decide: canDecide,
            can_deny: canDecide,
          },
        ],
      },
    ],
  }
  return group
}

test('Incoming requests shows Approve/Deny on an actionable row and reloads after a decision', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  let incomingCalls = 0
  let decideUrl = ''
  installDashboardFetch({
    incoming: () => {
      incomingCalls = incomingCalls + 1
      if (incomingCalls === 1) {
        return makeFakeResponse(true, 200, makeIncomingGroup(true))
      }
      // After the decision reload, the queue is empty.
      return makeFakeResponse(true, 200, { groups: [] })
    },
    decide: (urlText) => {
      decideUrl = urlText
      return makeFakeResponse(true, 200, { id: 'c1', status: 'approved', approved_quantity: 2 })
    },
  })

  renderDashboard()

  expect(await screen.findByText('Lemons')).toBeTruthy()
  expect(screen.getByText(/Bob requested 2/)).toBeTruthy()
  const approveButton = screen.getByRole('button', { name: 'Approve' })
  expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy()

  fireEvent.click(approveButton)

  await waitFor(() => {
    expect(screen.getByText('No incoming requests.')).toBeTruthy()
  })
  expect(decideUrl).toContain('/api/claims/c1/approve')
  expect(incomingCalls).toBe(2)
})

test('Incoming requests shows a non-actionable row read-only with no buttons', async () => {
  setLoggedIn()
  installDashboardFetch({ incoming: () => makeFakeResponse(true, 200, makeIncomingGroup(false)) })

  renderDashboard()

  expect(await screen.findByText(/Bob requested 2/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull()
})

test('an exhausted listing still shows Deny (not Approve) on a pending request', async () => {
  // The bug fix: when remaining quantity is 0 the backend sends can_decide false
  // (cannot approve) but can_deny true (can still deny). The row must show Deny
  // and hide Approve, so the owner can clear the pending request.
  setLoggedIn()
  const body = {
    groups: [
      {
        listing_id: 'lemons',
        listing_title: 'Lemons',
        listing_status: 'active',
        remaining_quantity: 0,
        pending: [
          {
            id: 'c1',
            claimant_id: 'bob',
            claimant_name: 'Bob',
            requested_quantity: 2,
            requested_at: '2026-07-01T09:00:00.000Z',
            can_decide: false,
            can_deny: true,
          },
        ],
      },
    ],
  }
  installDashboardFetch({ incoming: () => makeFakeResponse(true, 200, body) })

  renderDashboard()

  expect(await screen.findByText(/Bob requested 2/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy()
})

test('double-clicking Approve fires the decision only once', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  let decideCount = 0
  installDashboardFetch({
    incoming: () => makeFakeResponse(true, 200, makeIncomingGroup(true)),
    decide: () => {
      decideCount = decideCount + 1
      return makeFakeResponse(true, 200, { id: 'c1', status: 'approved', approved_quantity: 2 })
    },
  })

  renderDashboard()

  const approveButton = await screen.findByRole('button', { name: 'Approve' })
  fireEvent.click(approveButton)
  fireEvent.click(approveButton)
  await waitForStateUpdates()

  expect(decideCount).toBe(1)
})

test('Incoming requests shows the empty state when nothing is pending', async () => {
  setLoggedIn()
  installDashboardFetch({ incoming: () => makeFakeResponse(true, 200, { groups: [] }) })

  renderDashboard()

  expect(await screen.findByText('No incoming requests.')).toBeTruthy()
})

// --- US-24: Outgoing requests section ---

function makeOutgoingBody() {
  const body = {
    pending: [
      {
        id: 'r1',
        listing_id: 'l1',
        listing_title: 'Their Lemons',
        requested_quantity: 2,
        approved_quantity: null,
        status: 'requested',
        requested_at: '2026-07-01T09:00:00.000Z',
        approved_at: null,
        denied_at: null,
      },
    ],
    approved: [],
    denied: [],
  }
  return body
}

test('Outgoing requests shows only pending requests, with a plain title and a Withdraw button', async () => {
  setLoggedIn()
  installDashboardFetch({ myRequests: () => makeFakeResponse(true, 200, makeOutgoingBody()) })

  renderDashboard()

  expect(await screen.findByText(/Their Lemons/)).toBeTruthy()
  // The outgoing title is plain text, not a link.
  expect(screen.queryByRole('link', { name: 'Their Lemons' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Withdraw Request' })).toBeTruthy()
})

test('clicking Withdraw calls the withdraw endpoint and reloads', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  let myRequestsCalls = 0
  let withdrawUrl = ''
  installDashboardFetch({
    myRequests: () => {
      myRequestsCalls = myRequestsCalls + 1
      if (myRequestsCalls === 1) {
        return makeFakeResponse(true, 200, makeOutgoingBody())
      }
      return makeFakeResponse(true, 200, { pending: [], approved: [], denied: [] })
    },
    withdraw: (urlText) => {
      withdrawUrl = urlText
      return makeFakeResponse(true, 200, { id: 'r1', status: 'cancelled' })
    },
  })

  renderDashboard()

  const withdrawButton = await screen.findByRole('button', { name: 'Withdraw Request' })
  fireEvent.click(withdrawButton)

  await waitFor(() => {
    expect(screen.getByText('You have no pending requests.')).toBeTruthy()
  })
  expect(withdrawUrl).toContain('/api/claims/r1/withdraw')
  expect(myRequestsCalls).toBe(2)
})

// --- US-24: section links and the exchange-history placeholder ---

test('the section links point to the requests, my-requests, and my-listings pages', async () => {
  setLoggedIn()
  installDashboardFetch({})

  renderDashboard()

  // Wait for a section to finish loading so the links are present.
  expect(await screen.findByText('No incoming requests.')).toBeTruthy()

  // Two links now read "See All Incoming Requests" (the nav bullet and the
  // Incoming section), and both point to the same page.
  const seeAllRequestsLinks = screen.getAllByRole('link', { name: 'See All Incoming Requests' })
  expect(seeAllRequestsLinks.length).toBeGreaterThan(0)
  expect(seeAllRequestsLinks[0].getAttribute('href')).toBe('/requests')

  const seeAllYours = screen.getByRole('link', { name: 'See All My Requests' })
  expect(seeAllYours.getAttribute('href')).toBe('/my-requests')

  // Two links now read "See All My Listings" (the nav bullet and the My
  // Active Listings section), and both point to the same page.
  const browseMineLinks = screen.getAllByRole('link', { name: 'See All My Listings' })
  expect(browseMineLinks.length).toBeGreaterThan(0)
  expect(browseMineLinks[0].getAttribute('href')).toBe('/my-listings')
})

test('the exchange-history placeholder shows all six claim-status subheadings', async () => {
  setLoggedIn()
  installDashboardFetch({})

  renderDashboard()

  // The exchange-history section is static markup, so it is present right away.
  expect(screen.getByRole('heading', { name: 'Exchange History' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Requested' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Approved' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Picked up' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Completed' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Cancelled' })).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Denied' })).toBeTruthy()
})

// --- US-24: per-section error handling and failed actions ---

test('the Incoming requests section shows an error line on an HTTP failure', async () => {
  setLoggedIn()
  installDashboardFetch({ incoming: () => makeFakeResponse(false, 503, { detail: 'down' }) })

  renderDashboard()

  expect(await screen.findByText('Could not load incoming requests.')).toBeTruthy()
})

test('the My Active Listings section shows a transport error', async () => {
  setLoggedIn()
  installDashboardFetch({
    myListings: () => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    },
  })

  renderDashboard()

  expect(await screen.findByText(/Timeout: no answer from the backend/)).toBeTruthy()
})

test('the Outgoing requests section shows an error line on an HTTP failure', async () => {
  setLoggedIn()
  installDashboardFetch({ myRequests: () => makeFakeResponse(false, 503, { detail: 'down' }) })

  renderDashboard()

  expect(await screen.findByText('Could not load outgoing requests.')).toBeTruthy()
})

test('a failed decision shows the server message via an alert', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  let alertMessage = ''
  vi.stubGlobal('alert', (message: string) => {
    alertMessage = message
  })
  installDashboardFetch({
    incoming: () => makeFakeResponse(true, 200, makeIncomingGroup(true)),
    decide: () =>
      makeFakeResponse(false, 409, {
        detail: 'This request is not pending, so it cannot be approved.',
      }),
  })

  renderDashboard()

  const approveButton = await screen.findByRole('button', { name: 'Approve' })
  fireEvent.click(approveButton)
  await waitForStateUpdates()

  expect(alertMessage).toContain('not pending')
})

test('a failed withdraw shows the server message via an alert', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  let alertMessage = ''
  vi.stubGlobal('alert', (message: string) => {
    alertMessage = message
  })
  installDashboardFetch({
    myRequests: () => makeFakeResponse(true, 200, makeOutgoingBody()),
    withdraw: () =>
      makeFakeResponse(false, 409, {
        detail: 'This request is not pending, so it cannot be withdrawn.',
      }),
  })

  renderDashboard()

  const withdrawButton = await screen.findByRole('button', { name: 'Withdraw Request' })
  fireEvent.click(withdrawButton)
  await waitForStateUpdates()

  expect(alertMessage).toContain('not pending')
})

test('cancelling the decision confirm does not call the decide endpoint', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return false
  })
  let decideCount = 0
  installDashboardFetch({
    incoming: () => makeFakeResponse(true, 200, makeIncomingGroup(true)),
    decide: () => {
      decideCount = decideCount + 1
      return makeFakeResponse(true, 200, { id: 'c1', status: 'approved', approved_quantity: 2 })
    },
  })

  renderDashboard()

  const approveButton = await screen.findByRole('button', { name: 'Approve' })
  fireEvent.click(approveButton)
  await waitForStateUpdates()

  expect(decideCount).toBe(0)
})
