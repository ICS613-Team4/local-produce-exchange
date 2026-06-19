// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import ListingDetailPage from './ListingDetailPage'

type FakeResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
}

// Unmount components, restore the real fetch, and clear localStorage after
// every test, so one test cannot leak into the next.
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

// Renders the detail page at /listings/abc with a matching route, so useParams
// reads the id the way the real app does.
function renderDetailPage() {
  render(
    <MemoryRouter initialEntries={['/listings/abc']}>
      <Routes>
        <Route path="/listings/:id" element={<ListingDetailPage />} />
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

// A full active-listing body with two distinct quantity values and both tag
// groups, so the tests can prove each is shown under the right label.
function makeActiveListing() {
  const listing = {
    id: 'abc',
    owner_id: 'member-123',
    title: 'Backyard Lemons',
    description: 'Sweet Meyer lemons.',
    category: 'Fruit',
    total_quantity: 6,
    remaining_quantity: 4,
    dietary_tags: ['vegan', 'vegetarian'],
    allergen_tags: ['contains nuts'],
    pickup_start: '2026-07-01T09:00:00.000Z',
    pickup_end: '2026-07-01T11:00:00.000Z',
    status: 'active',
    created_at: '2026-06-19T00:00:00.000Z',
  }
  return listing
}

function makeListingWithTitle(title: string) {
  const listing = makeActiveListing()
  listing.id = title
  listing.title = title
  return listing
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
  window.localStorage.setItem('memberId', 'member-123')
  window.localStorage.setItem('memberName', 'Bob Baker')
  window.localStorage.setItem('memberEmail', 'bob@example.com')
}

function DetailPageWithSecondListingButton() {
  const navigate = useNavigate()

  function handleSecondListingClick() {
    navigate('/listings/second')
  }

  return (
    <>
      <button onClick={handleSecondListingClick}>Second listing</button>
      <ListingDetailPage />
    </>
  )
}

async function waitForStateUpdates() {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

test('shows the listing details and the logged-in nav for an active listing', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeActiveListing())
  })

  renderDetailPage()

  // The details appear once the load resolves.
  expect(await screen.findByText('Backyard Lemons')).toBeTruthy()
  expect(screen.getByText('Sweet Meyer lemons.')).toBeTruthy()
  expect(screen.getByText('Category: Fruit')).toBeTruthy()
  // Both quantity numbers show under their own labels (they are different).
  expect(screen.getByText('Quantity available: 6')).toBeTruthy()
  expect(screen.getByText('Remaining quantity: 4')).toBeTruthy()
  // Both tag groups show.
  expect(screen.getByText('Dietary tags: vegan, vegetarian')).toBeTruthy()
  expect(screen.getByText('Allergen tags: contains nuts')).toBeTruthy()
  // The pickup window shows each timestamp in the browser's locale and local
  // time zone, with the zone's short name appended, not the raw ISO string. We
  // build the expected text the same way the page does, so this passes on any
  // machine's locale or time zone.
  const timeZoneOptions = { timeZoneName: 'short' as const }
  const expectedPickupStart = new Date('2026-07-01T09:00:00.000Z').toLocaleString(
    undefined,
    timeZoneOptions,
  )
  const expectedPickupEnd = new Date('2026-07-01T11:00:00.000Z').toLocaleString(
    undefined,
    timeZoneOptions,
  )
  expect(screen.getByText('Pickup start: ' + expectedPickupStart)).toBeTruthy()
  expect(screen.getByText('Pickup end: ' + expectedPickupEnd)).toBeTruthy()
  // A plain-words note tells the user the times are in their own local zone.
  expect(screen.getByText(/All times are shown in your local time zone/)).toBeTruthy()
  // The logged-in nav shows the dashboard link and the log out button.
  expect(screen.getByRole('link', { name: 'Go to dashboard' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Log out' })).toBeTruthy()
  // The home and about links show in this (logged-in) state too.
  expect(screen.getByRole('link', { name: 'Go to home page' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Go to about page' })).toBeTruthy()
})

test('logging out clears the stored credentials and shows the logged-out view', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeActiveListing())
  })

  renderDetailPage()
  // Wait for the logged-in render, then click Log out.
  const logoutButton = await screen.findByRole('button', { name: 'Log out' })
  fireEvent.click(logoutButton)

  // After logout the page switches to the logged-out view.
  expect(await screen.findByRole('link', { name: 'Go to login page' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull()
  // All three credential keys are cleared.
  expect(window.localStorage.getItem('memberId')).toBeNull()
  expect(window.localStorage.getItem('memberName')).toBeNull()
  expect(window.localStorage.getItem('memberEmail')).toBeNull()
})

test('a stale-session 401 clears the credentials and shows the logged-out view', async () => {
  // The stored id no longer matches a member, so the backend answers 401.
  window.localStorage.setItem('memberId', 'stale-id')
  window.localStorage.setItem('memberName', 'Bob Baker')
  window.localStorage.setItem('memberEmail', 'bob@example.com')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 401, { detail: 'Not authenticated. Unknown member.' })
  })

  renderDetailPage()

  // The effect clears the creds, so the not-logged-in message appears.
  expect(await screen.findByText('You need to be logged in to see this page.')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Go to login page' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull()
  // Every credential key is cleared, not just memberId.
  expect(window.localStorage.getItem('memberId')).toBeNull()
  expect(window.localStorage.getItem('memberName')).toBeNull()
  expect(window.localStorage.getItem('memberEmail')).toBeNull()
})

test('shows the unavailable message on a 404', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 404, { detail: 'This listing is unavailable.' })
  })

  renderDetailPage()

  const message = await screen.findByText('This listing is unavailable.')
  expect(message).toBeTruthy()
  // The details did not render.
  expect(screen.queryByText('Backyard Lemons')).toBeNull()
})

test('shows None for empty tag lists and the plain logged-in line with no stored name', async () => {
  // memberId is the auth truth; memberName can be empty, which shows the plain
  // "Logged in." line. Empty tag lists read as "None".
  window.localStorage.setItem('memberId', 'member-123')
  const listing = makeActiveListing()
  listing.dietary_tags = []
  listing.allergen_tags = []
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, listing)
  })

  renderDetailPage()

  expect(await screen.findByText('Dietary tags: None')).toBeTruthy()
  expect(screen.getByText('Allergen tags: None')).toBeTruthy()
  // With no stored name, the nav shows the plain line, not "Logged in as ...".
  expect(screen.getByText('Logged in.')).toBeTruthy()
})

test('shows the detail message on a generic HTTP error', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 503, { detail: 'Could not read the listing right now.' })
  })

  renderDetailPage()

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Could not read the listing right now.')
  // This is the generic-error branch, not the 404 branch.
  expect(screen.queryByText('This listing is unavailable.')).toBeNull()
})

test('shows the transport error message when the request fails', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  renderDetailPage()

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Timeout')
  // This is the transport branch, not the 404 branch.
  expect(screen.queryByText('This listing is unavailable.')).toBeNull()
})

test('renders the not-logged-in message and does not fetch when logged out', async () => {
  let fetchCallCount = 0
  vi.stubGlobal('fetch', async () => {
    fetchCallCount = fetchCallCount + 1
    return makeFakeResponse(true, 200, makeActiveListing())
  })

  renderDetailPage()

  expect(screen.getByText('You need to be logged in to see this page.')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Go to login page' })).toBeTruthy()
  // The home and about links show in the logged-out state as well.
  expect(screen.getByRole('link', { name: 'Go to home page' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Go to about page' })).toBeTruthy()
  // Logged out, the page must not call the backend.
  await waitForStateUpdates()
  expect(fetchCallCount).toBe(0)
})

test('ignores an older response after the route changes to another listing', async () => {
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
    <MemoryRouter initialEntries={['/listings/first']}>
      <Routes>
        <Route path="/listings/:id" element={<DetailPageWithSecondListingButton />} />
      </Routes>
    </MemoryRouter>,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Second listing' }))

  secondResponse.resolve(makeFakeResponse(true, 200, makeListingWithTitle('Second Listing')))
  expect(await screen.findByText('Second Listing')).toBeTruthy()

  firstResponse.resolve(makeFakeResponse(true, 200, makeListingWithTitle('First Listing')))
  await waitForStateUpdates()

  expect(screen.getByText('Second Listing')).toBeTruthy()
  expect(screen.queryByText('First Listing')).toBeNull()
})
