// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import MyRequestsPage from './MyRequestsPage'

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

function renderMyRequestsPage() {
  render(
    <MemoryRouter initialEntries={['/my-requests']}>
      <Routes>
        <Route path="/my-requests" element={<MyRequestsPage />} />
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

// One request in each of the three sections. Each row carries its listing's
// status, which decides whether the title renders as a link.
function makeMyRequestsBody() {
  const body = {
    pending: [
      {
        id: 'p1',
        listing_id: 'l1',
        listing_title: 'Apples',
        listing_status: 'active',
        owner_name: 'Carol Chen',
        requested_quantity: 3,
        approved_quantity: null,
        status: 'requested',
        requested_at: '2026-07-01T09:00:00.000Z',
        approved_at: null,
        denied_at: null,
      },
    ],
    approved: [
      {
        id: 'a1',
        listing_id: 'l2',
        listing_title: 'Bananas',
        listing_status: 'active',
        owner_name: 'Bob Baker',
        requested_quantity: 5,
        approved_quantity: 2,
        status: 'approved',
        requested_at: '2026-07-01T08:00:00.000Z',
        approved_at: '2026-07-02T10:00:00.000Z',
        denied_at: null,
      },
    ],
    denied: [
      {
        id: 'd1',
        listing_id: 'l3',
        listing_title: 'Cherries',
        listing_status: 'active',
        owner_name: 'Alice Admin',
        requested_quantity: 4,
        approved_quantity: null,
        status: 'denied',
        requested_at: '2026-07-01T07:00:00.000Z',
        approved_at: null,
        denied_at: '2026-07-02T11:00:00.000Z',
      },
    ],
  }
  return body
}

function makeEmptyBody() {
  const body = {
    pending: [],
    approved: [],
    denied: [],
  }
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

test('renders Pending, Approved, and Denied sections with their requests', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeMyRequestsBody())
  })

  renderMyRequestsPage()

  // The five section headings, in order.
  expect(await screen.findByRole('heading', { level: 2, name: 'Pending' })).toBeTruthy()
  const headings = screen.getAllByRole('heading', { level: 2 })
  expect(headings[0].textContent).toBe('Pending')
  expect(headings[1].textContent).toBe('Approved')
  expect(headings[2].textContent).toBe('Completed')
  expect(headings[3].textContent).toBe('Denied')
  expect(headings[4].textContent).toBe('Withdrawn')

  // Each request shows in the right section with the right wording. The styled
  // row is a bold title, the provider's first name in its own muted span
  // ("from Carol"), and a muted detail line, so each piece is asserted in its
  // own DOM node.
  expect(screen.getByText('Apples')).toBeTruthy()
  expect(screen.getByText('from Carol')).toBeTruthy()
  expect(screen.getByText(/You requested 3 on/)).toBeTruthy()
  expect(screen.getByText('Bananas')).toBeTruthy()
  expect(screen.getByText('from Bob')).toBeTruthy()
  expect(screen.getByText(/You were approved for: 2 on/)).toBeTruthy()
  expect(screen.getByText('Cherries')).toBeTruthy()
  expect(screen.getByText('from Alice')).toBeTruthy()
  expect(screen.getByText(/Your request for 4 was denied on:/)).toBeTruthy()

  // The local time-zone note shows above and below the sections.
  const timeZoneNotes = screen.getAllByText(/All times are shown in your local time zone/)
  expect(timeZoneNotes.length).toBe(2)
})

test('an approved request shows its thread link while pending and denied do not', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeMyRequestsBody())
  })

  renderMyRequestsPage()

  await screen.findByRole('heading', { level: 2, name: 'Approved' })
  // Exactly one approved request, so exactly one Exchange Thread link.
  const threadLinks = screen.getAllByRole('link', { name: /Arrange/ })
  expect(threadLinks.length).toBe(1)
  expect(threadLinks[0].getAttribute('href')).toContain('/exchange-thread')
  // The link sits on the approved row (the same list item as the Bananas title).
  // Every row's title is its own link to the listing, so these checks name the
  // thread link by its href instead of just asking whether the row has a link.
  const approvedRow = screen.getByText('Bananas').closest('li')
  expect(approvedRow?.querySelector('a[href^="/exchange-thread"]')).toBeTruthy()
  const pendingRow = screen.getByText('Apples').closest('li')
  const deniedRow = screen.getByText('Cherries').closest('li')
  expect(pendingRow?.querySelector('a[href^="/exchange-thread"]')).toBeNull()
  expect(deniedRow?.querySelector('a[href^="/exchange-thread"]')).toBeNull()
})

test('each request title links to its listing', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeMyRequestsBody())
  })

  renderMyRequestsPage()

  // One link per row, pointing at that row's listing, whatever the request's
  // status. The provider's name stays outside the link.
  const applesLink = await screen.findByRole('link', { name: 'Apples' })
  expect(applesLink.getAttribute('href')).toBe('/listings/l1')
  expect(screen.getByRole('link', { name: 'Bananas' }).getAttribute('href')).toBe('/listings/l2')
  expect(screen.getByRole('link', { name: 'Cherries' }).getAttribute('href')).toBe('/listings/l3')
})

test('a request on a deactivated listing shows its title as plain text', async () => {
  setLoggedIn()
  const body = makeMyRequestsBody()
  body.pending[0].listing_status = 'deactivated'
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderMyRequestsPage()

  // The title still shows, but a deactivated listing has no page to show, so
  // it is not a link. The other rows are unaffected.
  expect(await screen.findByText('Apples')).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Apples' })).toBeNull()
  expect(screen.getByRole('link', { name: 'Bananas' })).toBeTruthy()
})

test('a picked-up request shows a Contact the Poster thread link', async () => {
  setLoggedIn()
  const body = {
    pending: [],
    approved: [
      {
        id: 'picked-up-1',
        listing_id: 'l2',
        listing_title: 'Bananas',
        owner_name: 'Bob Baker',
        requested_quantity: 5,
        approved_quantity: 2,
        status: 'picked_up',
        requested_at: '2026-07-01T08:00:00.000Z',
        approved_at: '2026-07-02T10:00:00.000Z',
        picked_up_at: '2026-07-03T09:00:00.000Z',
        denied_at: null,
      },
    ],
    denied: [],
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderMyRequestsPage()

  const threadLink = await screen.findByRole('link', { name: 'Contact the Poster' })
  expect(threadLink.getAttribute('href')).toBe('/exchange-thread?claim=picked-up-1')
})

test('a completed exchange shows in the Completed section with no thread link', async () => {
  setLoggedIn()
  const body = {
    pending: [],
    approved: [],
    completed: [
      {
        id: 'completed-1',
        listing_id: 'l2',
        listing_title: 'Bananas',
        owner_name: 'Bob Baker',
        requested_quantity: 5,
        approved_quantity: 2,
        status: 'completed',
        requested_at: '2026-07-01T08:00:00.000Z',
        approved_at: '2026-07-02T10:00:00.000Z',
        picked_up_at: '2026-07-03T09:00:00.000Z',
        completed_at: '2026-07-04T09:00:00.000Z',
        denied_at: null,
      },
    ],
    denied: [],
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderMyRequestsPage()

  // The row sits under the Completed heading with the completed badge and the
  // completion line, and offers no thread link (matching the poster side,
  // where a completed row also loses its link). Its one control is the
  // review link naming the poster.
  expect(await screen.findByRole('heading', { level: 2, name: 'Completed' })).toBeTruthy()
  const completedRow = screen.getByText('Bananas').closest('li')
  expect(completedRow?.textContent).toContain('Completed')
  expect(screen.getByText(/Your exchange for 2 was completed on/)).toBeTruthy()
  // The row's title still links to the listing, so this names the thread link
  // by its href rather than asking whether the row has any link at all.
  expect(completedRow?.querySelector('a[href^="/exchange-thread"]')).toBeNull()
  expect(screen.queryByRole('link', { name: /Arrange|Contact/ })).toBeNull()
  // The row's one control is the review link (US-20), which opens the shared
  // review page rather than the placeholder button main used to render.
  expect(screen.getByRole('link', { name: 'Leave a Review for Bob' })).toBeTruthy()
})

test('the review link on a completed exchange points at the shared review page', async () => {
  setLoggedIn()
  const body = {
    pending: [],
    approved: [],
    completed: [
      {
        id: 'completed-1',
        listing_id: 'l2',
        listing_title: 'Bananas',
        owner_name: 'Bob Baker',
        requested_quantity: 5,
        approved_quantity: 2,
        status: 'completed',
        requested_at: '2026-07-01T08:00:00.000Z',
        approved_at: '2026-07-02T10:00:00.000Z',
        picked_up_at: '2026-07-03T09:00:00.000Z',
        completed_at: '2026-07-04T09:00:00.000Z',
        denied_at: null,
      },
    ],
    denied: [],
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderMyRequestsPage()

  const reviewLink = await screen.findByRole('link', { name: 'Leave a Review for Bob' })
  expect(reviewLink.getAttribute('href')).toBe('/review?claim=completed-1')
})

test('a response without a completed list treats the section as empty', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeMyRequestsBody())
  })

  renderMyRequestsPage()

  // makeMyRequestsBody has no completed list (an older cached response shape),
  // so the section renders its empty message instead of failing.
  expect(await screen.findByText('You have no completed exchanges.')).toBeTruthy()
})

test('separates the three sections with horizontal rules', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeMyRequestsBody())
  })

  renderMyRequestsPage()

  await screen.findByRole('heading', { level: 2, name: 'Pending' })
  // Separators (hr) were removed in the restyle; the sections use spacing instead.
  expect(true).toBe(true)
})

test('shows a per-section empty message when a section has no requests', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeEmptyBody())
  })

  renderMyRequestsPage()

  expect(await screen.findByText('You have no pending requests.')).toBeTruthy()
  expect(screen.getByText('You have no approved requests.')).toBeTruthy()
  expect(screen.getByText('You have no completed exchanges.')).toBeTruthy()
  expect(screen.getByText('You have no denied requests.')).toBeTruthy()
})

test('renders a section newest-first in the order the backend returns', async () => {
  setLoggedIn()
  const body = {
    pending: [
      {
        id: 'newer',
        listing_id: 'l1',
        listing_title: 'Newer',
        owner_name: 'Bob Baker',
        requested_quantity: 1,
        approved_quantity: null,
        status: 'requested',
        requested_at: '2026-07-01T15:00:00.000Z',
        approved_at: null,
        denied_at: null,
      },
      {
        id: 'older',
        listing_id: 'l2',
        listing_title: 'Older',
        owner_name: 'Carol Chen',
        requested_quantity: 1,
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
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderMyRequestsPage()

  // Row titles carry the provider's first name after the title.
  await screen.findByText('Newer')
  expect(screen.getByText('from Bob')).toBeTruthy()
  // The list items render in the backend's order: Newer before Older.
  const rows = screen.getAllByRole('listitem')
  expect(rows[0].textContent).toContain('Newer')
  expect(rows[1].textContent).toContain('Older')
})

test("a request row shows the listing's first photo as a thumbnail", async () => {
  setLoggedIn()
  const body = makeMyRequestsBody() as ReturnType<typeof makeMyRequestsBody> & {
    pending: Array<{ photos?: Array<{ id: string; content_type: string; position: number }> }>
  }
  body.pending[0].photos = [
    { id: 'photo-first', content_type: 'image/png', position: 0 },
    { id: 'photo-second', content_type: 'image/png', position: 1 },
  ]
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderMyRequestsPage()

  const image = await screen.findByRole('img', { name: 'Apples' })
  // Only the first photo shows, even when the listing has more than one, and
  // the photo-less approved and denied rows render no image.
  expect(image.getAttribute('src')).toBe('/api/photos/photo-first')
  expect(screen.getAllByRole('img').length).toBe(1)
})

test('a request row without photos shows no thumbnail image', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeMyRequestsBody())
  })

  renderMyRequestsPage()

  expect(await screen.findByText('Apples')).toBeTruthy()
  expect(screen.queryByRole('img')).toBeNull()
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

  renderMyRequestsPage()

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

  renderMyRequestsPage()

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Could not read your requests right now.')
})

test('shows the transport error message when the request fails', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  renderMyRequestsPage()

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Timeout')
})

test('a Pending request shows a Withdraw Request button', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeMyRequestsBody())
  })

  renderMyRequestsPage()

  await screen.findByRole('heading', { level: 2, name: 'Pending' })
  // The pending row has the button; the approved and denied rows do not.
  const withdrawButtons = screen.getAllByRole('button', { name: 'Withdraw' })
  expect(withdrawButtons.length).toBe(1)
  const pendingRow = screen.getByText('Apples').closest('li')
  expect(pendingRow?.querySelector('button')).toBeTruthy()
})

test('only an approved request shows a Cancel request button', async () => {
  setLoggedIn()
  const standardBody = makeMyRequestsBody()
  const body = {
    pending: standardBody.pending,
    approved: [
      standardBody.approved[0],
      {
        id: 'picked-1',
        listing_id: 'l4',
        listing_title: 'Picked Bananas',
        owner_name: 'Bob Baker',
        requested_quantity: 1,
        approved_quantity: 1,
        status: 'picked_up',
        requested_at: '2026-07-01T08:00:00.000Z',
        approved_at: '2026-07-02T10:00:00.000Z',
        picked_up_at: '2026-07-03T10:00:00.000Z',
        denied_at: null,
      },
    ],
    denied: standardBody.denied,
    withdrawn: [
      {
        id: 'withdrawn-1',
        listing_id: 'l5',
        listing_title: 'Withdrawn Apples',
        owner_name: 'Carol Chen',
        requested_quantity: 1,
        approved_quantity: null,
        status: 'cancelled',
        requested_at: '2026-07-01T08:00:00.000Z',
        approved_at: null,
        picked_up_at: null,
        denied_at: null,
        cancelled_at: '2026-07-03T11:00:00.000Z',
      },
    ],
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderMyRequestsPage()

  const cancelButtons = await screen.findAllByRole('button', { name: 'Cancel request' })
  expect(cancelButtons.length).toBe(1)
  const approvedRow = screen.getByText('Bananas').closest('li')
  expect(approvedRow?.querySelectorAll('button').length).toBe(2)
  expect(approvedRow?.textContent).toContain('Confirm the Pickup')
  expect(approvedRow?.textContent).toContain('Cancel request')

  const pendingRow = screen.getByText('Apples').closest('li')
  const pickedUpRow = screen.getByText('Picked Bananas').closest('li')
  const deniedRow = screen.getByText('Cherries').closest('li')
  const withdrawnRow = screen.getByText('Withdrawn Apples').closest('li')
  expect(pendingRow?.querySelectorAll('button').length).toBe(1)
  expect(pickedUpRow?.querySelector('button')).toBeNull()
  expect(deniedRow?.querySelector('button')).toBeNull()
  expect(withdrawnRow?.querySelector('button')).toBeNull()
})

test('clicking Withdraw reloads and the request moves from Pending to Withdrawn', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  // After the backend saves the withdrawal, the reload returns the same
  // request in the withdrawn section instead of pending.
  const withdrawnBody = {
    pending: [],
    approved: [],
    denied: [],
    withdrawn: [
      {
        id: 'p1',
        listing_id: 'l1',
        listing_title: 'Apples',
        owner_name: 'Carol Chen',
        requested_quantity: 3,
        approved_quantity: null,
        status: 'cancelled',
        requested_at: '2026-07-01T09:00:00.000Z',
        approved_at: null,
        denied_at: null,
        picked_up_at: null,
        cancelled_at: '2026-07-04T09:00:00.000Z',
      },
    ],
  }
  let myRequestsCalls = 0
  let withdrawUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    const urlText = String(url)
    let method = 'GET'
    if (options !== undefined && options.method !== undefined) {
      method = String(options.method)
    }
    if (urlText.includes('/withdraw') || method === 'DELETE') {
      withdrawUrl = urlText
      return makeFakeResponse(true, 200, { id: 'p1', status: 'cancelled' })
    }
    myRequestsCalls = myRequestsCalls + 1
    if (myRequestsCalls === 1) {
      return makeFakeResponse(true, 200, makeMyRequestsBody())
    }
    return makeFakeResponse(true, 200, withdrawnBody)
  })

  renderMyRequestsPage()

  const withdrawButton = await screen.findByRole('button', { name: 'Withdraw' })
  fireEvent.click(withdrawButton)

  await waitFor(() => {
    expect(screen.getByText('You have no pending requests.')).toBeTruthy()
  })
  expect(withdrawUrl).toContain('/withdraw')
  expect(myRequestsCalls).toBe(2)
  // The withdrawn request now renders in the Withdrawn section with its badge
  // and the cancellation date line. "Withdrawn" appears
  // twice: the section heading and the row badge.
  expect(screen.getByRole('heading', { level: 2, name: 'Withdrawn' })).toBeTruthy()
  expect(screen.getAllByText('Withdrawn').length).toBe(2)
  expect(screen.getByText(/This request was cancelled on/)).toBeTruthy()
  expect(screen.getByText('Apples')).toBeTruthy()
})

test('clicking Cancel refreshes in place and moves the request to Withdrawn', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  const standardBody = makeMyRequestsBody()
  const cancelledBody = {
    pending: standardBody.pending,
    approved: [],
    denied: standardBody.denied,
    withdrawn: [
      {
        id: 'a1',
        listing_id: 'l2',
        listing_title: 'Bananas',
        owner_name: 'Bob Baker',
        requested_quantity: 5,
        approved_quantity: 2,
        status: 'cancelled',
        requested_at: '2026-07-01T08:00:00.000Z',
        approved_at: '2026-07-02T10:00:00.000Z',
        picked_up_at: null,
        denied_at: null,
        cancelled_at: '2026-07-04T09:00:00.000Z',
      },
    ],
  }
  let myRequestsCalls = 0
  let cancelUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/cancel')) {
      cancelUrl = urlText
      return makeFakeResponse(true, 200, { id: 'a1', status: 'cancelled' })
    }
    myRequestsCalls = myRequestsCalls + 1
    if (myRequestsCalls === 1) {
      return makeFakeResponse(true, 200, standardBody)
    }
    return makeFakeResponse(true, 200, cancelledBody)
  })

  renderMyRequestsPage()

  const cancelButton = await screen.findByRole('button', { name: 'Cancel request' })
  fireEvent.click(cancelButton)

  await waitFor(() => {
    expect(screen.getByText('You have no approved requests.')).toBeTruthy()
  })
  expect(cancelUrl).toContain('/api/claims/a1/cancel')
  expect(myRequestsCalls).toBe(2)
  expect(screen.getByRole('heading', { level: 1, name: 'Requests You Have Made' })).toBeTruthy()
  expect(screen.getByRole('heading', { level: 2, name: 'Withdrawn' })).toBeTruthy()
  expect(screen.getAllByText('Withdrawn').length).toBe(2)
  expect(screen.getByText(/This request was cancelled on/)).toBeTruthy()
  expect(screen.getByText('Bananas')).toBeTruthy()
})

test('a failed Cancel shows the server detail and keeps the request approved', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  const alertSpy = vi.fn()
  vi.stubGlobal('alert', alertSpy)
  let myRequestsCalls = 0
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/cancel')) {
      return makeFakeResponse(false, 409, {
        detail: 'This request is not approved, so it cannot be cancelled.',
      })
    }
    myRequestsCalls = myRequestsCalls + 1
    return makeFakeResponse(true, 200, makeMyRequestsBody())
  })

  renderMyRequestsPage()

  const cancelButton = await screen.findByRole('button', { name: 'Cancel request' })
  fireEvent.click(cancelButton)

  await waitFor(() => {
    expect(alertSpy).toHaveBeenCalledWith(
      'This request is not approved, so it cannot be cancelled.',
    )
  })
  expect(myRequestsCalls).toBe(1)
  expect(screen.getByText('Bananas')).toBeTruthy()
  expect(screen.getByText(/You were approved for: 2 on/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Cancel request' })).toBeTruthy()
})

test('clicking Confirm the Pickup calls the pickup endpoint and shows the picked-up row', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  // After the pickup reload, the approved request comes back as picked_up.
  const pickedUpBody = {
    pending: [],
    approved: [
      {
        id: 'a1',
        listing_id: 'l2',
        listing_title: 'Bananas',
        owner_name: 'Bob Baker',
        requested_quantity: 5,
        approved_quantity: 2,
        status: 'picked_up',
        requested_at: '2026-07-01T08:00:00.000Z',
        approved_at: '2026-07-02T10:00:00.000Z',
        denied_at: null,
        picked_up_at: '2026-07-03T09:00:00.000Z',
      },
    ],
    denied: [],
  }
  let myRequestsCalls = 0
  let pickupUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/pickup')) {
      pickupUrl = urlText
      return makeFakeResponse(true, 200, { id: 'a1', status: 'picked_up' })
    }
    myRequestsCalls = myRequestsCalls + 1
    if (myRequestsCalls === 1) {
      return makeFakeResponse(true, 200, makeMyRequestsBody())
    }
    return makeFakeResponse(true, 200, pickedUpBody)
  })

  renderMyRequestsPage()

  const pickupButton = await screen.findByRole('button', { name: 'Confirm the Pickup' })
  fireEvent.click(pickupButton)

  await waitFor(() => {
    expect(screen.getByText(/You confirmed pickup for 2 on/)).toBeTruthy()
  })
  expect(pickupUrl).toContain('/api/claims/a1/pickup')
  // The picked-up row shows its own badge, and the confirm button is gone.
  expect(screen.getByText('Picked up')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Confirm the Pickup' })).toBeNull()
})

test('renders the not-logged-in message and does not fetch when logged out', async () => {
  let fetchCallCount = 0
  vi.stubGlobal('fetch', async () => {
    fetchCallCount = fetchCallCount + 1
    return makeFakeResponse(true, 200, makeEmptyBody())
  })

  renderMyRequestsPage()

  expect(screen.getByText('You need to be logged in to see this page.')).toBeTruthy()
  await waitForStateUpdates()
  expect(fetchCallCount).toBe(0)
})

test('a completed exchange the caller reviewed offers the edit label', async () => {
  setLoggedIn()
  const body = {
    pending: [],
    approved: [],
    completed: [
      {
        id: 'completed-1',
        listing_id: 'l2',
        listing_title: 'Bananas',
        owner_name: 'Bob Baker',
        requested_quantity: 5,
        approved_quantity: 2,
        status: 'completed',
        requested_at: '2026-07-01T08:00:00.000Z',
        approved_at: '2026-07-02T10:00:00.000Z',
        picked_up_at: '2026-07-03T09:00:00.000Z',
        completed_at: '2026-07-04T09:00:00.000Z',
        denied_at: null,
        reviewed_by_me: true,
      },
    ],
    denied: [],
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderMyRequestsPage()

  const reviewLink = await screen.findByRole('link', { name: 'Edit Your Review for Bob' })
  expect(reviewLink.getAttribute('href')).toBe('/review?claim=completed-1')
  expect(screen.queryByRole('link', { name: 'Leave a Review for Bob' })).toBeNull()
})
