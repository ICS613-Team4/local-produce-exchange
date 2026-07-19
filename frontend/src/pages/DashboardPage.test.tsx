// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

// The dashboard now loads five endpoints on mount: the listings preview
// (/api/listings), the caller's listings (/api/my-listings), the incoming queue
// (/api/request-queues), the outgoing requests (/api/my-requests), and the
// exchange history (/api/exchange-history). It also PATCHes
// /api/claims/<id>/approve|deny|withdraw|pickup|complete on a button click.
// This installs one fetch stub that routes by URL and method, so a test
// overrides only the pieces it cares about and the rest answer with empty,
// valid bodies.
type DashboardHandlers = {
  listings?: (urlText: string, options: RequestInit) => FakeResponse
  myListings?: () => FakeResponse
  incoming?: () => FakeResponse
  myRequests?: () => FakeResponse
  history?: () => FakeResponse
  decide?: (urlText: string) => FakeResponse
  withdraw?: (urlText: string) => FakeResponse
  pickup?: (urlText: string) => FakeResponse
  complete?: (urlText: string) => FakeResponse
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
      if (urlText.includes('/pickup')) {
        if (handlers.pickup !== undefined) {
          return handlers.pickup(urlText)
        }
        return makeFakeResponse(true, 200, { id: 'c', status: 'picked_up' })
      }
      if (urlText.includes('/complete')) {
        if (handlers.complete !== undefined) {
          return handlers.complete(urlText)
        }
        return makeFakeResponse(true, 200, { id: 'c', status: 'completed' })
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
    if (urlText.includes('/api/exchange-history')) {
      if (handlers.history !== undefined) {
        return handlers.history()
      }
      return makeFakeResponse(true, 200, makeEmptyHistory())
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

// An empty exchange-history body: six empty status groups.
function makeEmptyHistory() {
  const body = {
    requested: [] as object[],
    approved: [] as object[],
    picked_up: [] as object[],
    completed: [] as object[],
    cancelled: [] as object[],
    denied: [] as object[],
  }
  return body
}

// One exchange-history row in the shape the endpoint returns. The timestamps
// that match the status are filled in so the status line has a time to show.
function makeHistoryItem(id: string, title: string, status: string, side: string) {
  const item = {
    id: id,
    listing_id: 'listing-' + id,
    listing_title: title,
    side: side,
    other_party_name: 'Pat Partner',
    requested_quantity: 2,
    approved_quantity: null as number | null,
    status: status,
    requested_at: '2026-07-01T09:00:00.000Z',
    approved_at: null as string | null,
    picked_up_at: null as string | null,
    completed_at: null as string | null,
    cancelled_at: null as string | null,
    denied_at: null as string | null,
  }
  if (status === 'approved' || status === 'picked_up' || status === 'completed') {
    item.approved_quantity = 2
    item.approved_at = '2026-07-02T09:00:00.000Z'
  }
  if (status === 'picked_up' || status === 'completed') {
    item.picked_up_at = '2026-07-03T09:00:00.000Z'
  }
  if (status === 'completed') {
    item.completed_at = '2026-07-04T09:00:00.000Z'
  }
  if (status === 'cancelled') {
    item.cancelled_at = '2026-07-04T09:00:00.000Z'
  }
  if (status === 'denied') {
    item.denied_at = '2026-07-04T09:00:00.000Z'
  }
  return item
}

// A history body with one row in every cell of the grouping table's open rows
// plus one row per terminal status, so every tab has known contents:
//   Needs you:   requested+poster, approved+recipient, picked_up+poster
//   In progress: requested+recipient, approved+poster, picked_up+recipient
//   Finished:    completed, cancelled, denied
function makeFullHistory() {
  const body = makeEmptyHistory()
  body.requested = [
    makeHistoryItem('r-poster', 'Requested For Me To Decide', 'requested', 'poster'),
    makeHistoryItem('r-recipient', 'Requested Waiting On Them', 'requested', 'recipient'),
  ]
  body.approved = [
    makeHistoryItem('a-recipient', 'Approved For Me To Pick Up', 'approved', 'recipient'),
    makeHistoryItem('a-poster', 'Approved Waiting On Them', 'approved', 'poster'),
  ]
  body.picked_up = [
    makeHistoryItem('p-poster', 'Picked Up For Me To Complete', 'picked_up', 'poster'),
    makeHistoryItem('p-recipient', 'Picked Up Waiting On Them', 'picked_up', 'recipient'),
  ]
  body.completed = [makeHistoryItem('f-completed', 'Completed One', 'completed', 'recipient')]
  body.cancelled = [makeHistoryItem('f-cancelled', 'Cancelled One', 'cancelled', 'poster')]
  body.denied = [makeHistoryItem('f-denied', 'Denied One', 'denied', 'recipient')]
  return body
}

// The three tab panels, found by the ids the page gives them. Panels render
// even while hidden, so tests reach into a panel with within() and check the
// hidden attribute for which one is showing.
function getHistoryPanels() {
  const needsYouPanel = document.getElementById('history-panel-needs-you') as HTMLElement
  const inProgressPanel = document.getElementById('history-panel-in-progress') as HTMLElement
  const finishedPanel = document.getElementById('history-panel-finished') as HTMLElement
  return { needsYouPanel, inProgressPanel, finishedPanel }
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

  expect(screen.getByRole('heading', { name: /Welcome back/ })).toBeTruthy()

  const browseLink = screen.getByRole('link', { name: /Browse/i })
  expect(browseLink.getAttribute('href')).toBe('/browse')

  const createLink = screen.getByRole('link', { name: 'New Listing' })
  expect(createLink.getAttribute('href')).toBe('/listings/create')

  const myListingsLink = screen.getByRole('link', { name: /See all listings/i })
  expect(myListingsLink.getAttribute('href')).toBe('/my-listings')

  const inviteLink = screen.getByRole('link', { name: 'Invite' })
  expect(inviteLink.getAttribute('href')).toBe('/invite')

  // The profile quick action was replaced by Incoming Requests, which points
  // at the request-queues page like the summary card's link below.
  const incomingQuickAction = screen.getByRole('link', { name: /Incoming Requests/ })
  expect(incomingQuickAction.getAttribute('href')).toBe('/requests')
  expect(screen.queryByRole('link', { name: 'Profile' })).toBeNull()

  const incomingRequestsLink = screen.getByRole('link', {
    name: /See all incoming/i,
  })
  expect(incomingRequestsLink.getAttribute('href')).toBe('/requests')

  const myRequestsLink = screen.getByRole('link', { name: /See all my requests/i })
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
  expect(previewListItem?.textContent).toContain(postedExpected)

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
  expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy()
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

  const withdrawButton = await screen.findByRole('button', { name: 'Withdraw' })
  fireEvent.click(withdrawButton)

  await waitFor(() => {
    expect(screen.getByText('You have no pending requests.')).toBeTruthy()
  })
  expect(withdrawUrl).toContain('/api/claims/r1/withdraw')
  expect(myRequestsCalls).toBe(2)
})

// --- US-24: section links ---

test('the section links point to the requests, my-requests, and my-listings pages', async () => {
  setLoggedIn()
  installDashboardFetch({})

  renderDashboard()

  // Wait for a section to finish loading so the links are present.
  expect(await screen.findByText('No incoming requests.')).toBeTruthy()

  // Two links now point to the incoming queue.
  const seeAllRequestsLinks = screen.getAllByRole('link', { name: /See all incoming/i })
  expect(seeAllRequestsLinks.length).toBeGreaterThan(0)
  expect(seeAllRequestsLinks[0].getAttribute('href')).toBe('/requests')

  const seeAllYours = screen.getByRole('link', { name: /See all my requests/i })
  expect(seeAllYours.getAttribute('href')).toBe('/my-requests')

  // The My Active Listings card links to the full listings page.
  const browseMineLinks = screen.getAllByRole('link', { name: /See all listings/i })
  expect(browseMineLinks.length).toBeGreaterThan(0)
  expect(browseMineLinks[0].getAttribute('href')).toBe('/my-listings')
})

// --- US-24: the exchange-history section ---

test('the exchange history opens on the Needs you tab with every subheading rendered empty', async () => {
  setLoggedIn()
  installDashboardFetch({ history: () => makeFakeResponse(true, 200, makeEmptyHistory()) })

  renderDashboard()

  expect(screen.getByRole('heading', { name: 'Exchange History' })).toBeTruthy()

  // Needs you is the tab selected on load; the other two are not.
  const needsYouTab = await screen.findByRole('tab', { name: /Needs you/ })
  const inProgressTab = screen.getByRole('tab', { name: /In progress/ })
  const finishedTab = screen.getByRole('tab', { name: /Finished/ })
  expect(needsYouTab.getAttribute('aria-selected')).toBe('true')
  expect(inProgressTab.getAttribute('aria-selected')).toBe('false')
  expect(finishedTab.getAttribute('aria-selected')).toBe('false')

  // Only the Needs you panel is showing.
  const { needsYouPanel, inProgressPanel, finishedPanel } = getHistoryPanels()
  expect(needsYouPanel.hasAttribute('hidden')).toBe(false)
  expect(inProgressPanel.hasAttribute('hidden')).toBe(true)
  expect(finishedPanel.hasAttribute('hidden')).toBe(true)

  // Scenario 2: with no activity, every eligible subheading still renders in
  // its tab (the two open tabs carry the three open statuses each, and the
  // Finished tab carries the three terminal ones), each with the empty note.
  expect(within(needsYouPanel).getByText('Requested')).toBeTruthy()
  expect(within(needsYouPanel).getByText('Approved')).toBeTruthy()
  expect(within(needsYouPanel).getByText('Picked up')).toBeTruthy()
  expect(within(inProgressPanel).getByText('Requested')).toBeTruthy()
  expect(within(inProgressPanel).getByText('Approved')).toBeTruthy()
  expect(within(inProgressPanel).getByText('Picked up')).toBeTruthy()
  expect(within(finishedPanel).getByText('Completed')).toBeTruthy()
  expect(within(finishedPanel).getByText('Cancelled')).toBeTruthy()
  expect(within(finishedPanel).getByText('Denied')).toBeTruthy()
  expect(screen.getAllByText('Nothing here yet.').length).toBe(9)
})

test('each history tab shows its row count', async () => {
  setLoggedIn()
  installDashboardFetch({ history: () => makeFakeResponse(true, 200, makeFullHistory()) })

  renderDashboard()

  // Three rows land in each tab (see makeFullHistory), and the count rides in
  // the tab's badge, so it is part of the tab's text.
  const needsYouTab = await screen.findByRole('tab', { name: /Needs you/ })
  const inProgressTab = screen.getByRole('tab', { name: /In progress/ })
  const finishedTab = screen.getByRole('tab', { name: /Finished/ })
  expect(needsYouTab.textContent).toContain('3')
  expect(inProgressTab.textContent).toContain('3')
  expect(finishedTab.textContent).toContain('3')
})

test('clicking a tab reveals its panel and hides the previous one without a second fetch', async () => {
  setLoggedIn()
  let historyCalls = 0
  installDashboardFetch({
    history: () => {
      historyCalls = historyCalls + 1
      return makeFakeResponse(true, 200, makeEmptyHistory())
    },
  })

  renderDashboard()

  await screen.findByRole('tab', { name: /Needs you/ })
  const { needsYouPanel, inProgressPanel, finishedPanel } = getHistoryPanels()

  fireEvent.click(screen.getByRole('tab', { name: /In progress/ }))
  expect(needsYouPanel.hasAttribute('hidden')).toBe(true)
  expect(inProgressPanel.hasAttribute('hidden')).toBe(false)
  expect(finishedPanel.hasAttribute('hidden')).toBe(true)
  expect(screen.getByRole('tab', { name: /In progress/ }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('tab', { name: /Needs you/ }).getAttribute('aria-selected')).toBe('false')

  fireEvent.click(screen.getByRole('tab', { name: /Finished/ }))
  expect(inProgressPanel.hasAttribute('hidden')).toBe(true)
  expect(finishedPanel.hasAttribute('hidden')).toBe(false)

  fireEvent.click(screen.getByRole('tab', { name: /Needs you/ }))
  expect(needsYouPanel.hasAttribute('hidden')).toBe(false)
  expect(finishedPanel.hasAttribute('hidden')).toBe(true)

  // The whole history loaded once; the tabs only chose what to show.
  expect(historyCalls).toBe(1)
})

test('each history row lands in the tab the grouping table specifies', async () => {
  setLoggedIn()
  installDashboardFetch({ history: () => makeFakeResponse(true, 200, makeFullHistory()) })

  renderDashboard()

  await screen.findByRole('tab', { name: /Needs you/ })
  const { needsYouPanel, inProgressPanel, finishedPanel } = getHistoryPanels()

  // Needs you: the member must act (requested+poster, approved+recipient,
  // picked_up+poster).
  expect(within(needsYouPanel).getByText('Requested For Me To Decide')).toBeTruthy()
  expect(within(needsYouPanel).getByText('Approved For Me To Pick Up')).toBeTruthy()
  expect(within(needsYouPanel).getByText('Picked Up For Me To Complete')).toBeTruthy()
  expect(within(needsYouPanel).queryByText('Requested Waiting On Them')).toBeNull()
  expect(within(needsYouPanel).queryByText('Approved Waiting On Them')).toBeNull()
  expect(within(needsYouPanel).queryByText('Picked Up Waiting On Them')).toBeNull()

  // In progress: the other party must act (requested+recipient,
  // approved+poster, picked_up+recipient).
  expect(within(inProgressPanel).getByText('Requested Waiting On Them')).toBeTruthy()
  expect(within(inProgressPanel).getByText('Approved Waiting On Them')).toBeTruthy()
  expect(within(inProgressPanel).getByText('Picked Up Waiting On Them')).toBeTruthy()
  expect(within(inProgressPanel).queryByText('Requested For Me To Decide')).toBeNull()

  // Finished: the three terminal statuses, whichever side the member was on.
  expect(within(finishedPanel).getByText('Completed One')).toBeTruthy()
  expect(within(finishedPanel).getByText('Cancelled One')).toBeTruthy()
  expect(within(finishedPanel).getByText('Denied One')).toBeTruthy()
  expect(within(finishedPanel).queryByText('Requested For Me To Decide')).toBeNull()
})

test('an empty subheading still shows its empty note next to one with rows', async () => {
  setLoggedIn()
  const body = makeEmptyHistory()
  body.approved = [makeHistoryItem('a1', 'Approved For Me To Pick Up', 'approved', 'recipient')]
  installDashboardFetch({ history: () => makeFakeResponse(true, 200, body) })

  renderDashboard()

  await screen.findByRole('tab', { name: /Needs you/ })
  const { needsYouPanel } = getHistoryPanels()

  // The Approved group holds the row; Requested and Picked up keep the note.
  expect(within(needsYouPanel).getByText('Approved For Me To Pick Up')).toBeTruthy()
  expect(within(needsYouPanel).getAllByText('Nothing here yet.').length).toBe(2)
})

test('a history row shows the listing link, quantity, party wording, and status time', async () => {
  setLoggedIn()
  installDashboardFetch({ history: () => makeFakeResponse(true, 200, makeFullHistory()) })

  renderDashboard()

  // A recipient row reads "from" the owner and carries the approved time.
  const recipientLink = await screen.findByRole('link', { name: 'Approved For Me To Pick Up' })
  expect(recipientLink.getAttribute('href')).toBe('/listings/listing-a-recipient')
  const recipientRow = recipientLink.closest('li')
  expect(recipientRow?.textContent).toContain('(2)')
  expect(recipientRow?.textContent).toContain('from Pat Partner')
  const timeZoneOptions = { timeZoneName: 'short' as const }
  const approvedExpected = new Date('2026-07-02T09:00:00.000Z').toLocaleString(undefined, timeZoneOptions)
  expect(recipientRow?.textContent).toContain('Approved ' + approvedExpected)

  // A poster row reads "for" the claimant.
  const posterLink = screen.getByRole('link', { name: 'Requested For Me To Decide' })
  const posterRow = posterLink.closest('li')
  expect(posterRow?.textContent).toContain('for Pat Partner')
  const requestedExpected = new Date('2026-07-01T09:00:00.000Z').toLocaleString(undefined, timeZoneOptions)
  expect(posterRow?.textContent).toContain('Requested ' + requestedExpected)
})

test('a requested poster row links to the requests page and waiting rows show the hint', async () => {
  setLoggedIn()
  installDashboardFetch({ history: () => makeFakeResponse(true, 200, makeFullHistory()) })

  renderDashboard()

  await screen.findByRole('tab', { name: /Needs you/ })
  const { needsYouPanel, inProgressPanel, finishedPanel } = getHistoryPanels()

  // The poster's requested row links out to the all-requests page filtered to
  // its listing, where Approve and Deny already live.
  const reviewLink = within(needsYouPanel).getByText('Review this request')
  expect(reviewLink.getAttribute('href')).toBe('/requests?listing=listing-r-poster')

  // Every In progress row shows who it is waiting on, so the right side never
  // looks like a control failed to render.
  expect(within(inProgressPanel).getAllByText('Waiting on Pat Partner').length).toBe(3)

  // Finished rows carry no control and no hint.
  expect(within(finishedPanel).queryByText('Waiting on Pat Partner')).toBeNull()
  expect(within(finishedPanel).queryByText('Review this request')).toBeNull()
  expect(within(finishedPanel).queryByText('Confirm pickup')).toBeNull()
  expect(within(finishedPanel).queryByText('Mark exchange complete')).toBeNull()
})

test('the exchange-thread link shows on both sides once the poster has approved', async () => {
  setLoggedIn()
  installDashboardFetch({ history: () => makeFakeResponse(true, 200, makeFullHistory()) })

  renderDashboard()

  await screen.findByRole('tab', { name: /Needs you/ })
  const { needsYouPanel, inProgressPanel, finishedPanel } = getHistoryPanels()

  // Approved rows on both sides carry Arrange the Exchange: the recipient's
  // row in Needs you (next to Confirm pickup) and the poster's row in In
  // progress (next to the waiting hint).
  const arrangeLinks = screen.getAllByText('Arrange the Exchange')
  expect(arrangeLinks.length).toBe(2)
  const recipientArrange = within(needsYouPanel).getByText('Arrange the Exchange')
  expect(recipientArrange.getAttribute('href')).toBe('/exchange-thread?claim=a-recipient')
  const posterArrange = within(inProgressPanel).getByText('Arrange the Exchange')
  expect(posterArrange.getAttribute('href')).toBe('/exchange-thread?claim=a-poster')

  // Picked-up rows keep the thread reachable with the contact wording the
  // requests and my-requests pages use for that stage, again on both sides.
  const contactPoster = within(inProgressPanel).getByText('Contact the Poster')
  expect(contactPoster.getAttribute('href')).toBe('/exchange-thread?claim=p-recipient')
  const contactRecipient = within(needsYouPanel).getByText('Contact the Recipient')
  expect(contactRecipient.getAttribute('href')).toBe('/exchange-thread?claim=p-poster')

  // A requested row has not been approved, so it gets no thread link on
  // either side, and finished rows drop the link like the other pages do.
  expect(screen.getAllByText(/Arrange the Exchange|Contact the Poster|Contact the Recipient/).length).toBe(4)
  expect(within(finishedPanel).queryByText(/Arrange the Exchange|Contact the Poster|Contact the Recipient/)).toBeNull()
})

test('Confirm pickup shows only on the approved recipient row and calls the pickup endpoint', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  let historyCalls = 0
  let pickupUrl = ''
  installDashboardFetch({
    history: () => {
      historyCalls = historyCalls + 1
      return makeFakeResponse(true, 200, makeFullHistory())
    },
    pickup: (urlText) => {
      pickupUrl = urlText
      return makeFakeResponse(true, 200, { id: 'a-recipient', status: 'picked_up' })
    },
  })

  renderDashboard()

  await screen.findByRole('tab', { name: /Needs you/ })
  const { needsYouPanel, inProgressPanel } = getHistoryPanels()

  // Exactly one Confirm pickup control renders, on the approved recipient row
  // in the Needs you tab. The approved poster row (In progress) has none: the
  // backend allows the claimant only.
  const pickupButtons = screen.getAllByText('Confirm pickup')
  expect(pickupButtons.length).toBe(1)
  expect(needsYouPanel.contains(pickupButtons[0])).toBe(true)
  expect(within(inProgressPanel).queryByText('Confirm pickup')).toBeNull()

  fireEvent.click(pickupButtons[0])
  await waitFor(() => {
    expect(historyCalls).toBe(2)
  })
  expect(pickupUrl).toContain('/api/claims/a-recipient/pickup')
})

test('Mark exchange complete shows only on the picked-up poster row and calls the complete endpoint', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  let historyCalls = 0
  let completeUrl = ''
  installDashboardFetch({
    history: () => {
      historyCalls = historyCalls + 1
      return makeFakeResponse(true, 200, makeFullHistory())
    },
    complete: (urlText) => {
      completeUrl = urlText
      return makeFakeResponse(true, 200, { id: 'p-poster', status: 'completed' })
    },
  })

  renderDashboard()

  await screen.findByRole('tab', { name: /Needs you/ })
  const { needsYouPanel, inProgressPanel } = getHistoryPanels()

  // Exactly one Mark exchange complete control renders, on the picked-up
  // poster row in the Needs you tab. The picked-up recipient row (In
  // progress) has none: the backend allows the listing owner only.
  const completeButtons = screen.getAllByText('Mark exchange complete')
  expect(completeButtons.length).toBe(1)
  expect(needsYouPanel.contains(completeButtons[0])).toBe(true)
  expect(within(inProgressPanel).queryByText('Mark exchange complete')).toBeNull()

  fireEvent.click(completeButtons[0])
  await waitFor(() => {
    expect(historyCalls).toBe(2)
  })
  expect(completeUrl).toContain('/api/claims/p-poster/complete')
})

test('a failed pickup shows the server message via an alert', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  let alertMessage = ''
  vi.stubGlobal('alert', (message: string) => {
    alertMessage = message
  })
  installDashboardFetch({
    history: () => makeFakeResponse(true, 200, makeFullHistory()),
    pickup: () =>
      makeFakeResponse(false, 409, {
        detail: 'Only an approved request can be marked as picked up.',
      }),
  })

  renderDashboard()

  const pickupButton = await screen.findByText('Confirm pickup')
  fireEvent.click(pickupButton)
  await waitForStateUpdates()

  expect(alertMessage).toContain('approved request')
})

test('a failed complete shows the server message via an alert', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  let alertMessage = ''
  vi.stubGlobal('alert', (message: string) => {
    alertMessage = message
  })
  installDashboardFetch({
    history: () => makeFakeResponse(true, 200, makeFullHistory()),
    complete: () =>
      makeFakeResponse(false, 409, {
        detail: 'This exchange is not picked up, so it cannot be completed.',
      }),
  })

  renderDashboard()

  const completeButton = await screen.findByText('Mark exchange complete')
  fireEvent.click(completeButton)
  await waitForStateUpdates()

  expect(alertMessage).toContain('not picked up')
})

test('a pickup transport failure shows the error message via an alert', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  let alertMessage = ''
  vi.stubGlobal('alert', (message: string) => {
    alertMessage = message
  })
  installDashboardFetch({
    history: () => makeFakeResponse(true, 200, makeFullHistory()),
    pickup: () => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    },
  })

  renderDashboard()

  const pickupButton = await screen.findByText('Confirm pickup')
  fireEvent.click(pickupButton)
  await waitForStateUpdates()

  expect(alertMessage).toContain('Timeout: no answer from the backend')
})

test('a complete transport failure shows the error message via an alert', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  let alertMessage = ''
  vi.stubGlobal('alert', (message: string) => {
    alertMessage = message
  })
  installDashboardFetch({
    history: () => makeFakeResponse(true, 200, makeFullHistory()),
    complete: () => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    },
  })

  renderDashboard()

  const completeButton = await screen.findByText('Mark exchange complete')
  fireEvent.click(completeButton)
  await waitForStateUpdates()

  expect(alertMessage).toContain('Timeout: no answer from the backend')
})

test('cancelling the complete confirm does not call the complete endpoint', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return false
  })
  let completeCount = 0
  installDashboardFetch({
    history: () => makeFakeResponse(true, 200, makeFullHistory()),
    complete: () => {
      completeCount = completeCount + 1
      return makeFakeResponse(true, 200, { id: 'p-poster', status: 'completed' })
    },
  })

  renderDashboard()

  const completeButton = await screen.findByText('Mark exchange complete')
  fireEvent.click(completeButton)
  await waitForStateUpdates()

  expect(completeCount).toBe(0)
})

test('cancelling the pickup confirm does not call the pickup endpoint', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return false
  })
  let pickupCount = 0
  installDashboardFetch({
    history: () => makeFakeResponse(true, 200, makeFullHistory()),
    pickup: () => {
      pickupCount = pickupCount + 1
      return makeFakeResponse(true, 200, { id: 'a-recipient', status: 'picked_up' })
    },
  })

  renderDashboard()

  const pickupButton = await screen.findByText('Confirm pickup')
  fireEvent.click(pickupButton)
  await waitForStateUpdates()

  expect(pickupCount).toBe(0)
})

test('the exchange-history section shows an error line on an HTTP failure', async () => {
  setLoggedIn()
  installDashboardFetch({ history: () => makeFakeResponse(false, 503, { detail: 'down' }) })

  renderDashboard()

  expect(await screen.findByText('Could not load your exchange history.')).toBeTruthy()
})

test('the exchange-history section shows a transport error', async () => {
  setLoggedIn()
  installDashboardFetch({
    history: () => {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    },
  })

  renderDashboard()

  expect(await screen.findByText(/Timeout: no answer from the backend/)).toBeTruthy()
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

  const withdrawButton = await screen.findByRole('button', { name: 'Withdraw' })
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
