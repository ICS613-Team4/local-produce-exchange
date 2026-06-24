// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
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

// The dashboard makes one fetch: the listings preview to /api/listings. This
// stubs it so a test can shape the response and inspect the request.
function stubListingsFetch(handleListings: (urlText: string, options: RequestInit) => FakeResponse) {
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    const urlText = String(url)
    let usableOptions: RequestInit = {}
    if (options !== undefined) {
      usableOptions = options
    }
    return handleListings(urlText, usableOptions)
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

  // The two requests links live in this dashboard list: incoming (requests on
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
  stubListingsFetch((urlText, options) => {
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
  })

  renderDashboard()

  // The preview lists the latest titles, each linking to its detail page.
  const previewLink = await screen.findByRole('link', { name: 'Backyard Meyer Lemons' })
  expect(previewLink.getAttribute('href')).toBe('/listings/l1')

  // Each preview row shows the listing's posted time in parentheses, and the
  // local time-zone note shows under the preview.
  const timeZoneOptions = { timeZoneName: 'short' as const }
  const postedExpected = new Date('2026-06-19T00:00:00.000Z').toLocaleString(undefined, timeZoneOptions)
  const previewListItem = previewLink.closest('li')
  expect(previewListItem?.textContent).toContain('(posted on: ' + postedExpected + ')')
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

  // No stored memberId, so the preview request is skipped.
  expect(fetchWasCalled).toBe(false)
})

test('shows the empty preview message when there are no listings', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  stubListingsFetch(() => makeFakeResponse(true, 200, []))

  renderDashboard()

  expect(await screen.findByText('No listings yet.')).toBeTruthy()
})

test('shows a transport error in the preview when the request times out', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  stubListingsFetch(() => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  renderDashboard()

  expect(await screen.findByText(/Timeout: no answer from the backend/)).toBeTruthy()
})

test('shows an error in the preview on an HTTP failure', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  stubListingsFetch(() => makeFakeResponse(false, 503, { detail: 'down' }))

  renderDashboard()

  expect(await screen.findByText('Could not load the latest listings.')).toBeTruthy()
})

test('shows a See All Requests from Other Members link to the requests page', async () => {
  window.localStorage.setItem('memberId', 'dave')
  stubListingsFetch(() => makeFakeResponse(true, 200, []))

  renderDashboard()

  const link = await screen.findByRole('link', { name: 'See All Requests from Other Members' })
  expect(link.getAttribute('href')).toBe('/requests')
})
