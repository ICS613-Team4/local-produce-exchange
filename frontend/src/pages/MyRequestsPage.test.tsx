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

// One request in each of the three sections.
function makeMyRequestsBody() {
  const body = {
    pending: [
      {
        id: 'p1',
        listing_id: 'l1',
        listing_title: 'Apples',
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

  // The three section headings, in order.
  expect(await screen.findByRole('heading', { level: 2, name: 'Pending' })).toBeTruthy()
  const headings = screen.getAllByRole('heading', { level: 2 })
  expect(headings[0].textContent).toBe('Pending')
  expect(headings[1].textContent).toBe('Approved')
  expect(headings[2].textContent).toBe('Denied')

  // Each request shows in the right section with the right wording, prefixed by
  // the provider's first name (the owner the caller requested from).
  expect(screen.getByText(/Carol - Apples: You requested 3 on/)).toBeTruthy()
  expect(screen.getByText(/Bob - Bananas: You were approved for: 2 on/)).toBeTruthy()
  expect(screen.getByText(/Alice - Cherries: Your request for 4 was denied on:/)).toBeTruthy()

  // The local time-zone note shows under the sections.
  expect(screen.getByText(/All times are shown in your local time zone/)).toBeTruthy()
})

test('shows the Exchange Thread link only on approved requests', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeMyRequestsBody())
  })

  renderMyRequestsPage()

  await screen.findByRole('heading', { level: 2, name: 'Approved' })
  // Exactly one approved request, so exactly one Exchange Thread link.
  const threadLinks = screen.getAllByRole('link', { name: 'Arrange the Exchange' })
  expect(threadLinks.length).toBe(1)
  expect(threadLinks[0].getAttribute('href')).toContain('/exchange-thread')
  // The link sits on the approved row (the same list item as the Bananas text).
  const approvedRow = screen.getByText(/Bob - Bananas: You were approved for: 2 on/).closest('li')
  expect(approvedRow?.querySelector('a')).toBeTruthy()
})

test('separates the three sections with horizontal rules', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeMyRequestsBody())
  })

  renderMyRequestsPage()

  await screen.findByRole('heading', { level: 2, name: 'Pending' })
  // Two <hr> elements separate the three sections. An <hr> has the separator role.
  const separators = screen.getAllByRole('separator')
  expect(separators.length).toBe(2)
})

test('shows a per-section empty message when a section has no requests', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeEmptyBody())
  })

  renderMyRequestsPage()

  expect(await screen.findByText('You have no pending requests.')).toBeTruthy()
  expect(screen.getByText('You have no approved requests.')).toBeTruthy()
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

  await screen.findByText(/Newer: You requested/)
  // The list items render in the backend's order: Newer before Older.
  const rows = screen.getAllByRole('listitem')
  expect(rows[0].textContent).toContain('Newer')
  expect(rows[1].textContent).toContain('Older')
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
  const withdrawButtons = screen.getAllByRole('button', { name: 'Withdraw Request' })
  expect(withdrawButtons.length).toBe(1)
  const pendingRow = screen.getByText(/Carol - Apples: You requested 3 on/).closest('li')
  expect(pendingRow?.querySelector('button')).toBeTruthy()
})

test('clicking Withdraw calls the withdraw endpoint and reloads', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
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
    return makeFakeResponse(true, 200, makeEmptyBody())
  })

  renderMyRequestsPage()

  const withdrawButton = await screen.findByRole('button', { name: 'Withdraw Request' })
  fireEvent.click(withdrawButton)

  await waitFor(() => {
    expect(screen.getByText('You have no pending requests.')).toBeTruthy()
  })
  expect(withdrawUrl).toContain('/withdraw')
  expect(myRequestsCalls).toBe(2)
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
