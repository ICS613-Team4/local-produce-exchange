// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
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

// Two listings the caller has requested on, newest listing first, each group
// holding the caller's own request (claimant_name is the caller's name).
function makeMyRequestsBody() {
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
            claimant_id: 'me',
            claimant_name: 'Dave Diaz',
            requested_quantity: 3,
            requested_at: '2026-07-01T09:00:00.000Z',
          },
        ],
      },
      {
        listing_id: 'kabocha',
        listing_title: 'Kabocha Squash',
        listing_status: 'active',
        remaining_quantity: 4,
        pending: [
          {
            id: 'c2',
            claimant_id: 'me',
            claimant_name: 'Dave Diaz',
            requested_quantity: 1,
            requested_at: '2026-07-01T10:00:00.000Z',
          },
        ],
      },
    ],
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

test('renders the outgoing requests grouped by listing with timestamps', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeMyRequestsBody())
  })

  renderMyRequestsPage()

  expect(await screen.findByText('Backyard Meyer Lemons')).toBeTruthy()
  expect(screen.getByText('Kabocha Squash')).toBeTruthy()
  expect(screen.getByText('Remaining quantity: 24')).toBeTruthy()
  expect(screen.getByText(/You requested 3/)).toBeTruthy()
  expect(screen.getByText(/You requested 1/)).toBeTruthy()
  // The local time-zone note shows under the groups.
  expect(screen.getByText(/All times are shown in your local time zone/)).toBeTruthy()
})

test('renders the groups in the order the backend returns them', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeMyRequestsBody())
  })

  renderMyRequestsPage()

  expect(await screen.findByText('Backyard Meyer Lemons')).toBeTruthy()
  const headings = screen.getAllByRole('heading', { level: 2 })
  // Newest listing first, exactly as the backend ordered them.
  expect(headings[0].textContent).toBe('Backyard Meyer Lemons')
  expect(headings[1].textContent).toBe('Kabocha Squash')
})

test('marks a deactivated listing group with a suffix', async () => {
  setLoggedIn()
  const body = makeMyRequestsBody()
  body.groups[0].listing_status = 'deactivated'
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderMyRequestsPage()

  expect(await screen.findByText('Backyard Meyer Lemons (deactivated)')).toBeTruthy()
})

test('shows the empty message when the member has made no requests', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, { groups: [] })
  })

  renderMyRequestsPage()

  expect(await screen.findByText('You have not made any requests yet.')).toBeTruthy()
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

test('renders the not-logged-in message and does not fetch when logged out', async () => {
  let fetchCallCount = 0
  vi.stubGlobal('fetch', async () => {
    fetchCallCount = fetchCallCount + 1
    return makeFakeResponse(true, 200, { groups: [] })
  })

  renderMyRequestsPage()

  expect(screen.getByText('You need to be logged in to see this page.')).toBeTruthy()
  await waitForStateUpdates()
  expect(fetchCallCount).toBe(0)
})
