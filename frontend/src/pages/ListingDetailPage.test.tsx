// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

// Most listing tests now trigger a second fetch: the owner-only pending-count
// call to /api/request-queues. This helper answers the listing GET with the
// given response and answers that count call with an empty queue, so a listing
// test that is not about the count never has to handle it.
function stubListingFetch(getListingResponse: () => FakeResponse) {
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/api/request-queues')) {
      return makeFakeResponse(true, 200, { groups: [] })
    }
    return getListingResponse()
  })
}

// A request-queue response body for one listing with the given pending count,
// used by the pending-count control tests.
function makeCountQueueBody(listingId: string, pendingCount: number) {
  const pending = []
  for (let index = 0; index < pendingCount; index = index + 1) {
    pending.push({
      id: listingId + '-c' + index,
      claimant_id: 'm' + index,
      claimant_name: 'Member ' + index,
      requested_quantity: 1,
      requested_at: '2026-07-01T09:00:00.000Z',
    })
  }
  const body = {
    groups: [
      {
        listing_id: listingId,
        listing_title: 'Lemons',
        listing_status: 'active',
        remaining_quantity: 4,
        pending: pending,
      },
    ],
  }
  return body
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

test('shows the listing details for an active listing', async () => {
  setLoggedIn()
  stubListingFetch(() => makeFakeResponse(true, 200, makeActiveListing()))

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
  expect(screen.getByText('Pickup Window Start: ' + expectedPickupStart)).toBeTruthy()
  expect(screen.getByText('Pickup Window End: ' + expectedPickupEnd)).toBeTruthy()
  // The posted date shows, in the viewer's local zone.
  const expectedPosted = new Date('2026-06-19T00:00:00.000Z').toLocaleString(undefined, timeZoneOptions)
  expect(screen.getByText('Posted on: ' + expectedPosted)).toBeTruthy()
  // A plain-words note tells the user the times are in their own local zone.
  expect(screen.getByText(/All times are shown in your local time zone/)).toBeTruthy()
})

test('a stale-session 401 clears the credentials and fires the auth event', async () => {
  // The stored id no longer matches a member, so the backend answers 401.
  window.localStorage.setItem('memberId', 'stale-id')
  window.localStorage.setItem('memberName', 'Bob Baker')
  window.localStorage.setItem('memberEmail', 'bob@example.com')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 401, { detail: 'Not authenticated. Unknown member.' })
  })

  // Listen for the same-tab event the page fires after clearing a stale login,
  // so the shared nav can flip to the logged-out view without a route change.
  let authEventFired = false
  function handleAuthEvent() {
    authEventFired = true
  }
  window.addEventListener('auth-state-changed', handleAuthEvent)

  renderDetailPage()

  // The effect clears the creds, so the not-logged-in message appears.
  expect(await screen.findByText('You need to be logged in to see this page.')).toBeTruthy()
  // Every credential key is cleared, not just memberId.
  expect(window.localStorage.getItem('memberId')).toBeNull()
  expect(window.localStorage.getItem('memberName')).toBeNull()
  expect(window.localStorage.getItem('memberEmail')).toBeNull()
  // The page told the shared nav the login was cleared.
  expect(authEventFired).toBe(true)

  window.removeEventListener('auth-state-changed', handleAuthEvent)
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
  stubListingFetch(() => makeFakeResponse(true, 200, listing))

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

test('shows the edit link when the logged-in member owns the listing', async () => {
  setLoggedIn()
  stubListingFetch(() => makeFakeResponse(true, 200, makeActiveListing()))

  renderDetailPage()

  const editLink = await screen.findByRole('link', { name: 'Edit listing' })
  expect(editLink.getAttribute('href')).toBe('/listings/abc/edit')
})

test('hides the edit link when another member owns the listing', async () => {
  setLoggedIn()
  const listing = makeActiveListing()
  listing.owner_id = 'other-member'
  stubListingFetch(() => makeFakeResponse(true, 200, listing))

  renderDetailPage()

  expect(await screen.findByText('Backyard Lemons')).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Edit listing' })).toBeNull()
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

// --- US-17: the owner-only deactivate control ---

// The deactivate flow always fires the load GET first, then the deactivate POST
// on click. This stub answers any GET with an active listing the logged-in
// member owns, and runs handlePost for the deactivate POST (so a test can return
// a response or throw). It records each deactivate POST URL.
function stubDeactivateFetch(handlePost: () => Promise<FakeResponse>) {
  const postUrls: string[] = []
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    const urlText = String(url)
    let method = 'GET'
    if (options !== undefined && options.method !== undefined) {
      method = String(options.method)
    }
    if (method === 'POST') {
      postUrls.push(urlText)
      return handlePost()
    }
    if (urlText.includes('/api/request-queues')) {
      return makeFakeResponse(true, 200, { groups: [] })
    }
    return makeFakeResponse(true, 200, makeActiveListing())
  })
  return postUrls
}

// For the navigation tests: answer each GET with an active listing whose id and
// title match the requested listing id (pulled from the URL), and run handlePost
// for the deactivate POST. Both listings are owned by the logged-in member.
function stubFetchByListingId(handlePost: () => Promise<FakeResponse>) {
  const postUrls: string[] = []
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    const urlText = String(url)
    let method = 'GET'
    if (options !== undefined && options.method !== undefined) {
      method = String(options.method)
    }
    if (method === 'POST') {
      postUrls.push(urlText)
      return handlePost()
    }
    if (urlText.includes('/api/request-queues')) {
      return makeFakeResponse(true, 200, { groups: [] })
    }
    const urlParts = urlText.split('/')
    const requestedId = urlParts[urlParts.length - 1]
    const listing = makeActiveListing()
    listing.id = requestedId
    listing.title = 'Listing ' + requestedId
    return makeFakeResponse(true, 200, listing)
  })
  return postUrls
}

test('shows the deactivate button to the owner', async () => {
  setLoggedIn()
  stubListingFetch(() => makeFakeResponse(true, 200, makeActiveListing()))

  renderDetailPage()

  expect(await screen.findByRole('button', { name: 'Deactivate listing' })).toBeTruthy()
})

test('hides the deactivate button from a non-owner', async () => {
  setLoggedIn()
  const listing = makeActiveListing()
  listing.owner_id = 'other-member'
  stubListingFetch(() => makeFakeResponse(true, 200, listing))

  renderDetailPage()

  expect(await screen.findByText('Backyard Lemons')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Deactivate listing' })).toBeNull()
})

test('deactivates on confirm: posts, shows the success message, and hides the owner actions', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  const postUrls = stubDeactivateFetch(async () => {
    return makeFakeResponse(true, 204, {})
  })

  renderDetailPage()

  const button = await screen.findByRole('button', { name: 'Deactivate listing' })
  fireEvent.click(button)

  // The success confirmation appears as plain text (not an alert).
  expect(await screen.findByText('Listing deactivated.')).toBeTruthy()
  // Exactly one POST went to the deactivate path.
  expect(postUrls.length).toBe(1)
  expect(postUrls[0]).toBe('/api/listings/abc/deactivate')
  // The owner actions are gone: both the Edit link and the Deactivate button.
  expect(screen.queryByRole('button', { name: 'Deactivate listing' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Edit listing' })).toBeNull()
})

test('does not post when the confirm is cancelled', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return false
  })
  const postUrls = stubDeactivateFetch(async () => {
    return makeFakeResponse(true, 204, {})
  })

  renderDetailPage()

  const button = await screen.findByRole('button', { name: 'Deactivate listing' })
  fireEvent.click(button)
  await waitForStateUpdates()

  // No deactivate POST was made (the load GET still ran).
  expect(postUrls.length).toBe(0)
  // The button is still there, since nothing was deactivated.
  expect(screen.getByRole('button', { name: 'Deactivate listing' })).toBeTruthy()
})

test('shows a server error and keeps the deactivate button enabled', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  stubDeactivateFetch(async () => {
    return makeFakeResponse(false, 500, { detail: 'Server error while deactivating.' })
  })

  renderDetailPage()

  const button = await screen.findByRole('button', { name: 'Deactivate listing' })
  fireEvent.click(button)

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Server error while deactivating.')
  // The button is still on screen and re-enabled, so the user can retry.
  const buttonAfter = screen.getByRole('button', { name: 'Deactivate listing' })
  expect(buttonAfter.hasAttribute('disabled')).toBe(false)
})

test('shows a transport error and keeps the deactivate button enabled', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  stubDeactivateFetch(async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  renderDetailPage()

  const button = await screen.findByRole('button', { name: 'Deactivate listing' })
  fireEvent.click(button)

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Timeout')
  const buttonAfter = screen.getByRole('button', { name: 'Deactivate listing' })
  expect(buttonAfter.hasAttribute('disabled')).toBe(false)
})

test('clears the credentials and shows the logged-out view on a 401', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  stubDeactivateFetch(async () => {
    return makeFakeResponse(false, 401, { detail: 'Not authenticated. Unknown member.' })
  })

  // Listen for the same-tab event the page fires after clearing a stale login,
  // so the shared nav can flip to the logged-out view without a route change.
  let authEventFired = false
  function handleAuthEvent() {
    authEventFired = true
  }
  window.addEventListener('auth-state-changed', handleAuthEvent)

  renderDetailPage()

  const button = await screen.findByRole('button', { name: 'Deactivate listing' })
  fireEvent.click(button)

  // The page falls back to the logged-out view.
  expect(await screen.findByText('You need to be logged in to see this page.')).toBeTruthy()
  // Every credential key is cleared.
  expect(window.localStorage.getItem('memberId')).toBeNull()
  expect(window.localStorage.getItem('memberName')).toBeNull()
  expect(window.localStorage.getItem('memberEmail')).toBeNull()
  // The page told the shared nav the login was cleared.
  expect(authEventFired).toBe(true)

  window.removeEventListener('auth-state-changed', handleAuthEvent)
})

test('sends only one POST for a double-click', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  const postUrls = stubDeactivateFetch(async () => {
    return makeFakeResponse(true, 204, {})
  })

  renderDetailPage()

  const button = await screen.findByRole('button', { name: 'Deactivate listing' })
  // Two clicks in the same tick, before React can re-render and disable the
  // button. Clicking inside one act keeps both in the same tick, so the
  // synchronous ref guard (not the disabled attribute) is what drops the second
  // click. Either way only one POST goes out.
  await act(async () => {
    button.click()
    button.click()
  })

  expect(await screen.findByText('Listing deactivated.')).toBeTruthy()
  expect(postUrls.length).toBe(1)
})

test('shows a generic message when a deactivate failure carries no detail', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  // A server error whose body has no detail field falls back to the generic line.
  stubDeactivateFetch(async () => {
    return makeFakeResponse(false, 500, {})
  })

  renderDetailPage()

  const button = await screen.findByRole('button', { name: 'Deactivate listing' })
  fireEvent.click(button)

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Could not deactivate the listing. Please try again.')
  const buttonAfter = screen.getByRole('button', { name: 'Deactivate listing' })
  expect(buttonAfter.hasAttribute('disabled')).toBe(false)
})

test('resets the deactivate state when the route changes to another listing', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  stubFetchByListingId(async () => {
    return makeFakeResponse(true, 204, {})
  })

  render(
    <MemoryRouter initialEntries={['/listings/first']}>
      <Routes>
        <Route path="/listings/:id" element={<DetailPageWithSecondListingButton />} />
      </Routes>
    </MemoryRouter>,
  )

  expect(await screen.findByText('Listing first')).toBeTruthy()
  const button = await screen.findByRole('button', { name: 'Deactivate listing' })
  fireEvent.click(button)
  expect(await screen.findByText('Listing deactivated.')).toBeTruthy()

  // Navigate to a different listing.
  fireEvent.click(screen.getByRole('button', { name: 'Second listing' }))
  expect(await screen.findByText('Listing second')).toBeTruthy()

  // The deactivate state did not leak across listings.
  expect(screen.queryByText('Listing deactivated.')).toBeNull()
  expect(screen.getByRole('button', { name: 'Deactivate listing' })).toBeTruthy()
})

test('drops a late deactivate response after navigating to another listing', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  const pendingPost = makePendingResponse()
  stubFetchByListingId(() => {
    return pendingPost.promise
  })

  render(
    <MemoryRouter initialEntries={['/listings/first']}>
      <Routes>
        <Route path="/listings/:id" element={<DetailPageWithSecondListingButton />} />
      </Routes>
    </MemoryRouter>,
  )

  expect(await screen.findByText('Listing first')).toBeTruthy()
  const button = await screen.findByRole('button', { name: 'Deactivate listing' })
  // Start the deactivate POST on the first listing but leave it in flight.
  fireEvent.click(button)

  // Navigate to a second listing before the POST resolves.
  fireEvent.click(screen.getByRole('button', { name: 'Second listing' }))
  expect(await screen.findByText('Listing second')).toBeTruthy()

  // Now resolve the old first-listing POST.
  pendingPost.resolve(makeFakeResponse(true, 204, {}))
  await waitForStateUpdates()

  // The late response is dropped: the second listing shows no success message and
  // keeps its owner actions.
  expect(screen.queryByText('Listing deactivated.')).toBeNull()
  expect(screen.getByRole('link', { name: 'Edit listing' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Deactivate listing' })).toBeTruthy()
})

test('a pending deactivate on one listing does not block deactivating another', async () => {
  // Reproduces the cross-listing re-entry bug: with a component-wide boolean
  // guard, a request still in flight on listing A wrongly blocked the click on
  // listing B. The per-listing key guard must let B's click through, firing its
  // own confirm and its own POST.
  setLoggedIn()
  let confirmCount = 0
  vi.stubGlobal('confirm', () => {
    confirmCount = confirmCount + 1
    return true
  })

  const pendingFirstPost = makePendingResponse()
  const postUrls: string[] = []
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    const urlText = String(url)
    let method = 'GET'
    if (options !== undefined && options.method !== undefined) {
      method = String(options.method)
    }
    if (method === 'POST') {
      postUrls.push(urlText)
      if (urlText.includes('/first/')) {
        // Listing A's POST stays in flight.
        return pendingFirstPost.promise
      }
      // Listing B's POST resolves right away.
      return makeFakeResponse(true, 204, {})
    }
    if (urlText.includes('/api/request-queues')) {
      return makeFakeResponse(true, 200, { groups: [] })
    }
    const urlParts = urlText.split('/')
    const requestedId = urlParts[urlParts.length - 1]
    const listing = makeActiveListing()
    listing.id = requestedId
    listing.title = 'Listing ' + requestedId
    return makeFakeResponse(true, 200, listing)
  })

  render(
    <MemoryRouter initialEntries={['/listings/first']}>
      <Routes>
        <Route path="/listings/:id" element={<DetailPageWithSecondListingButton />} />
      </Routes>
    </MemoryRouter>,
  )

  // Deactivate listing A; its POST stays pending.
  expect(await screen.findByText('Listing first')).toBeTruthy()
  const firstButton = await screen.findByRole('button', { name: 'Deactivate listing' })
  fireEvent.click(firstButton)
  expect(confirmCount).toBe(1)

  // Navigate to listing B while A's POST is still in flight.
  fireEvent.click(screen.getByRole('button', { name: 'Second listing' }))
  expect(await screen.findByText('Listing second')).toBeTruthy()

  // Click B's Deactivate before A resolves. This must NOT be blocked.
  const secondButton = await screen.findByRole('button', { name: 'Deactivate listing' })
  fireEvent.click(secondButton)

  // B's deactivate went through: its success message shows.
  expect(await screen.findByText('Listing deactivated.')).toBeTruthy()
  // A second confirm fired and a second POST went out (to B's deactivate path).
  expect(confirmCount).toBe(2)
  let firstPostCount = 0
  let secondPostCount = 0
  for (const sentUrl of postUrls) {
    if (sentUrl.includes('/first/')) {
      firstPostCount = firstPostCount + 1
    }
    if (sentUrl.includes('/second/')) {
      secondPostCount = secondPostCount + 1
    }
  }
  expect(firstPostCount).toBe(1)
  expect(secondPostCount).toBe(1)

  // Resolve the still-pending A request so nothing dangles.
  pendingFirstPost.resolve(makeFakeResponse(true, 204, {}))
  await waitForStateUpdates()
})

// --- US-10: the owner-only pending-request control ---

test('shows the pending-request count and the View requests link to the owner', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/api/request-queues')) {
      return makeFakeResponse(true, 200, makeCountQueueBody('abc', 2))
    }
    return makeFakeResponse(true, 200, makeActiveListing())
  })

  renderDetailPage()

  expect(await screen.findByText('Pending requests: 2')).toBeTruthy()
  const viewLink = screen.getByRole('link', { name: 'View requests' })
  expect(viewLink.getAttribute('href')).toBe('/requests?listing=abc')
})

test('hides the pending-request count and View requests link from a non-owner', async () => {
  setLoggedIn()
  const listing = makeActiveListing()
  listing.owner_id = 'other-member'
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/api/request-queues')) {
      return makeFakeResponse(true, 200, makeCountQueueBody('abc', 2))
    }
    return makeFakeResponse(true, 200, listing)
  })

  renderDetailPage()

  expect(await screen.findByText('Backyard Lemons')).toBeTruthy()
  expect(screen.queryByText(/Pending requests:/)).toBeNull()
  expect(screen.queryByRole('link', { name: 'View requests' })).toBeNull()
})

test('a count-fetch 401 clears the credentials and falls back to logged-out', async () => {
  setLoggedIn()
  let authEventFired = false
  function handleAuthEvent() {
    authEventFired = true
  }
  window.addEventListener('auth-state-changed', handleAuthEvent)
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/api/request-queues')) {
      return makeFakeResponse(false, 401, { detail: 'Not authenticated. Unknown member.' })
    }
    return makeFakeResponse(true, 200, makeActiveListing())
  })

  renderDetailPage()

  expect(await screen.findByText('You need to be logged in to see this page.')).toBeTruthy()
  expect(window.localStorage.getItem('memberId')).toBeNull()
  expect(authEventFired).toBe(true)

  window.removeEventListener('auth-state-changed', handleAuthEvent)
})

test('a count-fetch failure leaves the detail page usable without the count', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/api/request-queues')) {
      return makeFakeResponse(false, 503, { detail: 'down' })
    }
    return makeFakeResponse(true, 200, makeActiveListing())
  })

  renderDetailPage()

  expect(await screen.findByText('Backyard Lemons')).toBeTruthy()
  // The owner control still shows the View requests link; only the count hides.
  expect(screen.getByRole('link', { name: 'View requests' })).toBeTruthy()
  expect(screen.queryByText(/Pending requests:/)).toBeNull()
})

test('drops a late count response after the route changes to another listing', async () => {
  setLoggedIn()
  const firstCount = makePendingResponse()
  const secondCount = makePendingResponse()
  let countCallCount = 0
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/api/request-queues')) {
      countCallCount = countCallCount + 1
      if (countCallCount === 1) {
        return firstCount.promise
      }
      if (countCallCount === 2) {
        return secondCount.promise
      }
      throw new Error('Unexpected count fetch')
    }
    // A listing GET: answer with a listing whose id matches the requested id,
    // owned by the logged-in member.
    const urlParts = urlText.split('/')
    const requestedId = urlParts[urlParts.length - 1]
    const listing = makeActiveListing()
    listing.id = requestedId
    listing.title = 'Listing ' + requestedId
    return makeFakeResponse(true, 200, listing)
  })

  render(
    <MemoryRouter initialEntries={['/listings/first']}>
      <Routes>
        <Route path="/listings/:id" element={<DetailPageWithSecondListingButton />} />
      </Routes>
    </MemoryRouter>,
  )

  // The first listing loads; its count request is left in flight.
  expect(await screen.findByText('Listing first')).toBeTruthy()

  // Navigate to the second listing; its count request is also in flight.
  fireEvent.click(screen.getByRole('button', { name: 'Second listing' }))
  expect(await screen.findByText('Listing second')).toBeTruthy()

  // Resolve the second (current) count first.
  secondCount.resolve(makeFakeResponse(true, 200, makeCountQueueBody('second', 5)))
  expect(await screen.findByText('Pending requests: 5')).toBeTruthy()

  // The stale first count resolves last and must be dropped.
  firstCount.resolve(makeFakeResponse(true, 200, makeCountQueueBody('first', 99)))
  await waitForStateUpdates()

  expect(screen.getByText('Pending requests: 5')).toBeTruthy()
  expect(screen.queryByText('Pending requests: 99')).toBeNull()
})
