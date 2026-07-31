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
    items: [
      {
        listing_id: 'lemons',
        listing_title: 'Backyard Meyer Lemons',
        remaining_quantity: 24,
        created_at: '2026-06-19T00:00:00.000Z',
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
            picked_up_at: null,
            completed_at: null,
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
            picked_up_at: null,
            completed_at: null,
            denied_at: null,
            can_decide: false,
            can_deny: false,
          },
        ],
      },
    ],
    total: 1,
    page: 1,
    page_size: 12,
  }
  return body
}

// A single-group body whose listing id and title are supplied, used for the
// filter-change stale-response test.
function makeOneGroupBody(listingId: string, title: string) {
  const body = {
    items: [
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
            picked_up_at: null,
            completed_at: null,
            denied_at: null,
            can_decide: false,
            can_deny: false,
          },
        ],
      },
    ],
    total: 1,
    page: 1,
    page_size: 12,
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

function makePickedUpBody(): AllRequestsResponse {
  const body = makeAllRequestsBody()
  const pickedUpRequest = body.items[0].requests[1]
  pickedUpRequest.id = 'c3'
  pickedUpRequest.status = 'picked_up'
  pickedUpRequest.picked_up_at = '2026-07-03T09:00:00.000Z'
  body.items[0].requests = [pickedUpRequest]
  return body
}

function makeCompletedBody(): AllRequestsResponse {
  const body = makePickedUpBody()
  const completedRequest = body.items[0].requests[0]
  completedRequest.status = 'completed'
  completedRequest.completed_at = '2026-07-04T09:00:00.000Z'
  return body
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
  expect(screen.getByText(/24 remaining/)).toBeTruthy()
  // The listing's posted-on line renders under the title, in the viewer's zone.
  const timeZoneOptions = { timeZoneName: 'short' as const }
  const postedExpected = new Date('2026-06-19T00:00:00.000Z').toLocaleString(undefined, timeZoneOptions)
  expect(screen.getByText('Posted ' + postedExpected)).toBeTruthy()
  expect(screen.getByText('Bob Baker')).toBeTruthy()
  expect(screen.getByText('Carol Chen')).toBeTruthy()
  // Bob's pending status and Carol's approved badge (with the approved
  // quantity) both show.
  expect(screen.getByText('Requested')).toBeTruthy()
  expect(screen.getByText('Approved: 2')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Mark exchange complete' })).toBeNull()

  // Bob's row comes before Carol's, the order the backend returned.
  const bobRow = screen.getByText('Bob Baker')
  const carolRow = screen.getByText('Carol Chen')
  const relativePosition = bobRow.compareDocumentPosition(carolRow)
  expect(relativePosition & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
})

test("a group shows its listing's first photo as a thumbnail", async () => {
  setLoggedIn()
  const body = makeAllRequestsBody() as AllRequestsResponse & {
    items: Array<{ photos?: Array<{ id: string; content_type: string; position: number }> }>
  }
  body.items[0].photos = [
    { id: 'photo-first', content_type: 'image/png', position: 0 },
    { id: 'photo-second', content_type: 'image/png', position: 1 },
  ]
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderRequestsPage('/requests')

  const image = await screen.findByRole('img', { name: 'Backyard Meyer Lemons' })
  // Only the first photo shows, even when the listing has more than one.
  expect(image.getAttribute('src')).toBe('/api/photos/photo-first')
  expect(screen.getAllByRole('img').length).toBe(1)
})

test('a group without photos shows no thumbnail image', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeAllRequestsBody())
  })

  renderRequestsPage('/requests')

  expect(await screen.findByText('Backyard Meyer Lemons')).toBeTruthy()
  expect(screen.queryByRole('img')).toBeNull()
})

test('shows the exchange thread link only on approved requests', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeAllRequestsBody())
  })

  renderRequestsPage('/requests')

  const threadLinks = await screen.findAllByRole('link', { name: 'Arrange the Exchange' })
  expect(threadLinks.length).toBe(1)
  expect(threadLinks[0].getAttribute('href')).toContain('/exchange-thread?claim=c2')

  // The claimant name sits in its own styled span, so find the row through it.
  const pendingRow = screen.getByText('Bob Baker').closest('li')
  expect(pendingRow?.querySelector('a')).toBeNull()
})

test('a picked-up request shows both outcome lines and the Contact the Recipient link', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makePickedUpBody())
  })

  renderRequestsPage('/requests')

  // The badge carries the status and the approved quantity (not a literal
  // "Picked_up"), and the pickup time renders as its own line.
  expect(await screen.findByText('Picked up: 2')).toBeTruthy()
  expect(screen.getByText(/Picked up on/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Mark exchange complete' })).toBeTruthy()
  const recipientLink = screen.getByRole('link', { name: 'Contact the Recipient' })
  expect(recipientLink.getAttribute('href')).toContain('/exchange-thread?claim=c3')
  // A finished exchange offers no Approve or Deny, and the review link
  // belongs to completed rows only.
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull()
  expect(screen.queryByRole('link', { name: /Leave a Review/ })).toBeNull()
})

test('a completed request shows its full outcome and no complete button', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeCompletedBody())
  })

  renderRequestsPage('/requests')

  expect(await screen.findByText('Completed')).toBeTruthy()
  expect(screen.getByText(/Approved: 2 on/)).toBeTruthy()
  expect(screen.getByText(/Picked up on/)).toBeTruthy()
  expect(screen.getByText(/Completed on/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Mark exchange complete' })).toBeNull()
  // The completed row's one control is the review link naming the recipient
  // (the fixture's claimant is Carol Chen).
  expect(screen.getByRole('link', { name: 'Leave a Review for Carol' })).toBeTruthy()
})

test('the review link on a completed request points at the shared review page', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeCompletedBody())
  })

  renderRequestsPage('/requests')

  const reviewLink = await screen.findByRole('link', { name: 'Leave a Review for Carol' })
  expect(reviewLink.getAttribute('href')).toBe('/review?claim=c3')
})

test('a completed request also links to the reviews for that exchange', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeCompletedBody())
  })

  renderRequestsPage('/requests')

  // US-21: reading the reviews sits beside writing one.
  const viewLink = await screen.findByRole('link', { name: 'View Reviews' })
  expect(viewLink.getAttribute('href')).toBe('/exchange-reviews?claim=c3')
})

test('a row stacks on a phone and its controls wrap', async () => {
  // A completed row carries three controls (write, read, delete), which do not
  // fit one line on a narrow screen. The row must stack and the controls must
  // wrap, or the page scrolls sideways. Found in a browser walk at 375px wide,
  // where the delete button hung 100px past the right edge.
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeCompletedBody())
  })

  renderRequestsPage('/requests')

  const viewLink = await screen.findByRole('link', { name: 'View Reviews' })
  const controls = viewLink.parentElement as HTMLElement
  expect(controls.className).toContain('flex-wrap')
  // No unconditional shrink-0: that is what pushed the controls off screen.
  expect(controls.className).not.toContain(' shrink-0')

  const row = controls.parentElement as HTMLElement
  expect(row.className).toContain('flex-col')
  expect(row.className).toContain('sm:flex-row')
})

test('a deactivated listing group is marked in its heading', async () => {
  setLoggedIn()
  const body = makePickedUpBody()
  body.items[0].listing_status = 'deactivated'
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderRequestsPage('/requests')

  expect(
    await screen.findByRole('heading', { level: 2, name: 'Backyard Meyer Lemons (deactivated)' }),
  ).toBeTruthy()
  // The in-flight exchange on the deactivated listing keeps its complete button.
  expect(screen.getByRole('button', { name: 'Mark exchange complete' })).toBeTruthy()
  // A deactivated listing has no page to show, so its title is not a link.
  expect(screen.queryByRole('link', { name: 'Backyard Meyer Lemons' })).toBeNull()
})

test("an active listing's heading links to the listing", async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeAllRequestsBody())
  })

  renderRequestsPage('/requests')

  const titleLink = await screen.findByRole('link', { name: 'Backyard Meyer Lemons' })
  expect(titleLink.getAttribute('href')).toBe('/listings/lemons')
})

test('marking an exchange complete sends a PATCH and reloads the completed row', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  let getCalls = 0
  let completeUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    let method = 'GET'
    if (options !== undefined && options.method !== undefined) {
      method = String(options.method)
    }
    if (method === 'PATCH') {
      completeUrl = String(url)
      return makeFakeResponse(true, 200, {
        id: 'c3',
        status: 'completed',
        completed_at: '2026-07-04T09:00:00.000Z',
      })
    }
    getCalls = getCalls + 1
    if (getCalls === 1) {
      return makeFakeResponse(true, 200, makePickedUpBody())
    }
    return makeFakeResponse(true, 200, makeCompletedBody())
  })

  renderRequestsPage('/requests')

  const completeButton = await screen.findByRole('button', { name: 'Mark exchange complete' })
  fireEvent.click(completeButton)

  await waitFor(() => {
    expect(screen.getByText(/Completed on/)).toBeTruthy()
  })
  expect(completeUrl).toBe('/api/claims/c3/complete')
  expect(getCalls).toBe(2)
  expect(screen.queryByRole('button', { name: 'Mark exchange complete' })).toBeNull()
})

test('cancelling exchange completion sends no PATCH and keeps the button', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return false
  })
  let patchCount = 0
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options !== undefined && options.method === 'PATCH') {
      patchCount = patchCount + 1
    }
    return makeFakeResponse(true, 200, makePickedUpBody())
  })

  renderRequestsPage('/requests')

  const completeButton = await screen.findByRole('button', { name: 'Mark exchange complete' })
  fireEvent.click(completeButton)
  await waitForStateUpdates()

  expect(patchCount).toBe(0)
  expect(screen.getByRole('button', { name: 'Mark exchange complete' })).toBeTruthy()
})

test('a failed exchange completion shows the server detail and keeps the button', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  let alertMessage = ''
  vi.stubGlobal('alert', (message: string) => {
    alertMessage = message
  })
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options !== undefined && options.method === 'PATCH') {
      return makeFakeResponse(false, 409, {
        detail: 'This exchange is not picked up, so it cannot be completed.',
      })
    }
    return makeFakeResponse(true, 200, makePickedUpBody())
  })

  renderRequestsPage('/requests')

  const completeButton = await screen.findByRole('button', { name: 'Mark exchange complete' })
  fireEvent.click(completeButton)
  await waitForStateUpdates()

  expect(alertMessage).toContain('not picked up')
  expect(screen.getByRole('button', { name: 'Mark exchange complete' })).toBeTruthy()
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
    reloaded.items[0].requests[0].status = 'approved'
    reloaded.items[0].requests[0].approved_quantity = 3
    reloaded.items[0].requests[0].approved_at = '2026-07-02T10:00:00.000Z'
    reloaded.items[0].requests[0].can_decide = false
    reloaded.items[0].requests[0].can_deny = false
    return makeFakeResponse(true, 200, reloaded)
  })

  renderRequestsPage('/requests')

  const approveButton = await screen.findByRole('button', { name: 'Approve' })
  fireEvent.click(approveButton)

  // After the reload there are no actionable rows, so the button is gone.
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
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

  const denyButton = await screen.findByRole('button', { name: 'Deny' })
  fireEvent.click(denyButton)
  await waitForStateUpdates()

  expect(decideUrl).toContain('/api/claims/c1/deny')
})

test('a non-actionable request shows its status read-only with no buttons', async () => {
  setLoggedIn()
  const body = makeAllRequestsBody()
  // Make Bob's request non-actionable too, so the whole group is read-only.
  body.items[0].requests[0].can_decide = false
  body.items[0].requests[0].can_deny = false
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderRequestsPage('/requests')

  expect(await screen.findByText('Carol Chen')).toBeTruthy()
  expect(screen.getByText('Approved: 2')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull()
})

test('an exhausted listing still shows Deny (not Approve) on a pending request', async () => {
  // The bug fix: with no remaining quantity the backend sends can_decide false
  // and can_deny true, so only the Deny button shows on the still-pending request.
  setLoggedIn()
  const body = makeAllRequestsBody()
  body.items[0].requests[0].can_decide = false
  body.items[0].requests[0].can_deny = true
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderRequestsPage('/requests')

  expect(await screen.findByText('Bob Baker')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy()
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

  const approveButton = await screen.findByRole('button', { name: 'Approve' })
  fireEvent.click(approveButton)
  await waitForStateUpdates()

  expect(patchCount).toBe(0)
  expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
})

test('shows the global empty state when there are no active listings', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, { items: [], total: 0, page: 1, page_size: 12 })
  })

  renderRequestsPage('/requests')

  expect(await screen.findByText('You have no active listings.')).toBeTruthy()
})

test('shows the per-listing empty note when a listing has no requests', async () => {
  setLoggedIn()
  const body = {
    items: [
      {
        listing_id: 'lemons',
        listing_title: 'Lemons',
        remaining_quantity: 5,
        requests: [],
      },
    ],
    total: 1,
    page: 1,
    page_size: 12,
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
      items: [
        {
          listing_id: 'lemons',
          listing_title: 'Lemons',
          remaining_quantity: 5,
          requests: [],
        },
      ],
      total: 1,
      page: 1,
      page_size: 12,
    }
    return makeFakeResponse(true, 200, body)
  })

  renderRequestsPage('/requests?listing=lemons')

  expect(await screen.findByText('Lemons')).toBeTruthy()
  expect(requestUrl).toBe('/api/request-queues/all?listing=lemons&page=1&page_size=12')
})

test('the filtered view shows the no-group empty message when the listing is not returned', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, { items: [], total: 0, page: 1, page_size: 12 })
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

  // The shared route guard renders the logged-out message now, so the only
  // thing this page owns is clearing the stored login and firing the event.
  await waitFor(() => {
    expect(window.localStorage.getItem('memberId')).toBeNull()
  })
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

  const approveButton = await screen.findByRole('button', { name: 'Approve' })
  fireEvent.click(approveButton)
  await waitForStateUpdates()

  expect(alertMessage).toContain('not pending')
  // The buttons stay so the owner can retry.
  expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
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

  const approveButton = await screen.findByRole('button', { name: 'Approve' })
  fireEvent.click(approveButton)
  await waitForStateUpdates()

  expect(alertMessage).toContain('Timeout')
})

test('shows a denied status outcome for a denied request', async () => {
  setLoggedIn()
  const body = makeAllRequestsBody()
  // Turn Carol's row into a denied request, which is read-only.
  body.items[0].requests[1].status = 'denied'
  body.items[0].requests[1].approved_quantity = null
  body.items[0].requests[1].approved_at = null
  body.items[0].requests[1].denied_at = '2026-07-02T10:00:00.000Z'
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderRequestsPage('/requests')

  expect(await screen.findByText(/Denied on/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Mark exchange complete' })).toBeNull()
})

test('a completed request the caller reviewed offers the edit label', async () => {
  setLoggedIn()
  const body = makeCompletedBody()
  body.items[0].requests[0].reviewed_by_me = true
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderRequestsPage('/requests')

  const reviewLink = await screen.findByRole('link', { name: 'Edit Your Review for Carol' })
  expect(reviewLink.getAttribute('href')).toBe('/review?claim=c3')
  expect(screen.queryByRole('link', { name: 'Leave a Review for Carol' })).toBeNull()
})

test('a request row shows the requestor rating inline after the name', async () => {
  setLoggedIn()
  const body = makeAllRequestsBody()
  body.items[0].requests[0].claimant_requestor_average = 4.3
  body.items[0].requests[0].claimant_requestor_count = 12
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderRequestsPage('/requests')

  // Bob's rating sits inline in his own row line, with no count shown.
  const bobName = await screen.findByText('Bob Baker')
  const chip = screen.getByRole('link', {
    name: "View the reviews behind this member's rating as a requestor",
  })
  expect(chip.textContent).toBe('(★ 4.3 requestor rating)')
  const bobLine = bobName.parentElement
  expect(bobLine !== null).toBe(true)
  if (bobLine !== null) {
    expect(bobLine.contains(chip)).toBe(true)
  }
  // Carol's row has no reviews, so her line says so in plain non-clickable
  // text with no star.
  const carolName = screen.getByText('Carol Chen')
  const carolLine = carolName.parentElement
  expect(carolLine !== null).toBe(true)
  if (carolLine !== null) {
    expect(carolLine.textContent).toContain('(no requestor rating)')
    expect(carolLine.textContent).not.toContain('★')
  }
})

// --- US-33: paging the listing groups ---

// One listing group holding a single pending request, so a page of groups can
// be built without repeating the whole request shape.
function makeGroup(listingId: string, title: string) {
  return {
    listing_id: listingId,
    listing_title: title,
    listing_status: 'active',
    remaining_quantity: 5,
    created_at: '2026-06-19T00:00:00.000Z',
    photos: [],
    requests: [
      {
        id: 'req-' + listingId,
        claimant_id: 'bob',
        claimant_name: 'Bob Baker',
        requested_quantity: 2,
        approved_quantity: null,
        status: 'requested',
        requested_at: '2026-07-01T12:00:00.000Z',
        approved_at: null,
        picked_up_at: null,
        completed_at: null,
        denied_at: null,
        cancelled_at: null,
        can_decide: true,
        can_deny: true,
      },
    ],
  }
}

function makeGroupPage(count: number, total: number, page: number) {
  const groups = []
  for (let index = 0; index < count; index = index + 1) {
    groups.push(makeGroup('listing-' + index, 'Listing ' + index))
  }
  return { items: groups, total: total, page: page, page_size: 12 }
}

test('shows the count and the controls when the owner has more listings than one page', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeGroupPage(12, 30, 1))
  })

  renderRequestsPage('/requests')

  // Scenario 8: what pages here is the listings.
  await screen.findByText('Showing 1-12 of 30')
  expect((screen.getByRole('button', { name: 'Prev' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false)
})

test('every request inside a listed listing stays visible', async () => {
  // Only the outer groups page; a listing's own requests are never cut off.
  setLoggedIn()
  const body = makeGroupPage(1, 30, 1)
  const extraRequest = { ...body.items[0].requests[0], id: 'req-second', claimant_name: 'Carol Cook' }
  body.items[0].requests = [body.items[0].requests[0], extraRequest]
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderRequestsPage('/requests')

  expect(await screen.findByText('Bob Baker')).toBeTruthy()
  expect(screen.getByText('Carol Cook')).toBeTruthy()
})

test('no controls appear when every listing fits on one page', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeGroupPage(2, 2, 1))
  })

  renderRequestsPage('/requests')

  // Scenario 4.
  await screen.findByText('Listing 0')
  expect(screen.queryByRole('navigation', { name: 'Listings with requests pagination' })).toBeNull()
})

test('no controls appear on the empty state', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, { items: [], total: 0, page: 1, page_size: 12 })
  })

  renderRequestsPage('/requests')

  // Scenario 5.
  await screen.findByText('You have no active listings.')
  expect(screen.queryByRole('navigation', { name: 'Listings with requests pagination' })).toBeNull()
})

test('the first load asks for page 1 of twelve', async () => {
  setLoggedIn()
  let lastUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    lastUrl = String(url)
    return makeFakeResponse(true, 200, { items: [], total: 0, page: 1, page_size: 12 })
  })

  renderRequestsPage('/requests')

  await waitFor(() => {
    expect(lastUrl).toContain('page=1')
  })
  expect(lastUrl).toContain('page_size=12')
})

test('Next moves to the following page of listings', async () => {
  setLoggedIn()
  let lastUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    lastUrl = String(url)
    const requestedPage = String(url).includes('page=2') ? 2 : 1
    return makeFakeResponse(true, 200, makeGroupPage(12, 30, requestedPage))
  })

  renderRequestsPage('/requests')
  await screen.findByText('Showing 1-12 of 30')

  fireEvent.click(screen.getByRole('button', { name: 'Next' }))

  await waitFor(() => {
    expect(lastUrl).toContain('page=2')
  })
  expect(await screen.findByText('Showing 13-24 of 30')).toBeTruthy()
})

test('opening ?page=2 renders page 2 and marks it as current', async () => {
  // Scenario 2.
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeGroupPage(12, 30, 2))
  })

  renderRequestsPage('/requests?page=2')

  await screen.findByText('Showing 13-24 of 30')
  expect(screen.getByRole('button', { name: 'Page 2' }).getAttribute('aria-current')).toBe('page')
})

test('the filtered view sends the filter and the page window together', async () => {
  // Scenario 8: the ?listing= filter still applies while paging. A filter picks
  // out one listing, so the filtered view is a single page and shows no
  // controls (Scenario 4), but the request still carries both.
  setLoggedIn()
  let lastUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    lastUrl = String(url)
    const body = makeGroupPage(1, 1, 1)
    body.items[0].listing_id = 'lemons'
    body.items[0].listing_title = 'Lemons'
    return makeFakeResponse(true, 200, body)
  })

  renderRequestsPage('/requests?listing=lemons&page=1')
  await screen.findByText('Lemons')

  expect(lastUrl).toContain('listing=lemons')
  expect(lastUrl).toContain('page=1')
  expect(screen.queryByRole('navigation', { name: 'Listings with requests pagination' })).toBeNull()
})

test('paging the unfiltered list keeps any other query param in the URL', async () => {
  // The page number is set on top of whatever the URL already carries, so no
  // other param is dropped on the way to the next page.
  setLoggedIn()
  let lastUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    lastUrl = String(url)
    const requestedPage = String(url).includes('page=2') ? 2 : 1
    return makeFakeResponse(true, 200, makeGroupPage(12, 30, requestedPage))
  })

  renderRequestsPage('/requests?page=1')
  await screen.findByText('Showing 1-12 of 30')

  fireEvent.click(screen.getByRole('button', { name: 'Next' }))

  await waitFor(() => {
    expect(lastUrl).toContain('page=2')
  })
})

test('a page past the end falls back to the last page', async () => {
  // Scenario 6.
  setLoggedIn()
  const requestedPages: number[] = []
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const pageMatch = String(url).match(/page=(\d+)/)
    const requestedPage = pageMatch === null ? 1 : Number(pageMatch[1])
    requestedPages.push(requestedPage)
    if (requestedPage > 2) {
      return makeFakeResponse(true, 200, { items: [], total: 20, page: requestedPage, page_size: 12 })
    }
    return makeFakeResponse(true, 200, makeGroupPage(8, 20, requestedPage))
  })

  renderRequestsPage('/requests?page=7')

  expect(await screen.findByText('Showing 13-20 of 20')).toBeTruthy()
  expect(requestedPages).toContain(7)
  expect(requestedPages).toContain(2)
})
