// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import NotificationsPage from './NotificationsPage'

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

function renderNotificationsPage() {
  render(
    <MemoryRouter initialEntries={['/notifications']}>
      <Routes>
        <Route path="/notifications" element={<NotificationsPage />} />
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

// Four notifications, newest first, the order the backend returns. The newest
// is an exchange-progress row (links to the exchange thread), the middle two
// are incoming-request-queue rows (both link to the Incoming Requests page),
// and the oldest has no claim and no queue kind, so it gets no link at all.
function makeNotificationsBody() {
  const body = {
    notifications: [
      {
        id: 'n4',
        claim_id: 'claim-9',
        kind: 'pickup_confirmed',
        message: 'Carol confirmed pickup for your listing.',
        is_read: false,
        created_at: '2026-07-02T10:00:00.000Z',
      },
      {
        id: 'n3',
        claim_id: 'claim-8',
        kind: 'request_withdrawn',
        message: 'Carol withdrew their request on your listing.',
        is_read: false,
        created_at: '2026-07-02T09:00:00.000Z',
      },
      {
        id: 'n2',
        claim_id: 'claim-7',
        kind: 'request_submitted',
        message: 'Carol requested 1 of your listing.',
        is_read: false,
        created_at: '2026-07-01T09:00:00.000Z',
      },
      {
        id: 'n1',
        claim_id: null,
        kind: 'request_approved',
        message: 'Your request for a listing was approved.',
        is_read: false,
        created_at: '2026-06-30T09:00:00.000Z',
      },
    ],
    unread_count: 4,
  }
  return body
}

function setLoggedIn() {
  window.localStorage.setItem('memberId', 'bob')
  window.localStorage.setItem('memberName', 'Bob Baker')
  window.localStorage.setItem('memberEmail', 'bob@example.com')
}

test('renders the notifications in the returned newest-first order', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeNotificationsBody())
  })

  renderNotificationsPage()

  expect(await screen.findByText('Carol confirmed pickup for your listing.')).toBeTruthy()
  expect(screen.getByText('Carol requested 1 of your listing.')).toBeTruthy()

  // The rows keep the order the backend returned: the newest message first.
  const rows = screen.getAllByRole('listitem')
  expect(rows.length).toBe(4)
  expect(rows[0].textContent).toContain('Carol confirmed pickup for your listing.')
  expect(rows[1].textContent).toContain('Carol withdrew their request on your listing.')
  expect(rows[2].textContent).toContain('Carol requested 1 of your listing.')
  expect(rows[3].textContent).toContain('Your request for a listing was approved.')
})

test('each notification kind links to the right place', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makeNotificationsBody())
  })

  renderNotificationsPage()

  expect(await screen.findByText('Carol confirmed pickup for your listing.')).toBeTruthy()

  // The exchange-progress row links to its exchange thread.
  const exchangeLinks = screen.getAllByRole('link', { name: 'Open the exchange' })
  expect(exchangeLinks.length).toBe(1)
  const linkTarget = exchangeLinks[0].getAttribute('href')
  expect(linkTarget).toContain('/exchange-thread?claim=')
  expect(linkTarget).toContain('claim-9')

  // The submitted row is about the member's incoming request queue, so it
  // links to the Incoming Requests page instead.
  const queueLinks = screen.getAllByRole('link', { name: 'Open your incoming requests' })
  expect(queueLinks.length).toBe(1)
  expect(queueLinks[0].getAttribute('href')).toBe('/requests')

  // The withdrawn row gets no link: the request already left the queue, so
  // there is nothing to open. Rows are newest first, so it is the second row.
  const rows = screen.getAllByRole('listitem')
  expect(rows[1].textContent).toContain('withdrew')
  expect(rows[1].textContent).not.toContain('Open the exchange')
  expect(rows[1].textContent).not.toContain('Open your incoming requests')

  // The claim-less row with a non-queue kind shows no link at all.
  expect(rows[3].textContent).not.toContain('Open the exchange')
  expect(rows[3].textContent).not.toContain('Open your incoming requests')
})

test('a cancelled-exchange notification keeps its exchange link', async () => {
  // The poster cancelling an approved exchange locks its thread, but the
  // requester's notification still links there: the thread stays readable
  // as history even though sending is closed.
  setLoggedIn()
  const body = {
    notifications: [
      {
        id: 'n9',
        claim_id: 'claim-12',
        kind: 'request_cancelled',
        message: "Your approved exchange for 'Thai Basil' was cancelled by the poster.",
        is_read: false,
        created_at: '2026-07-03T10:00:00.000Z',
      },
    ],
    unread_count: 1,
  }
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, body))

  renderNotificationsPage()

  const exchangeLink = await screen.findByRole('link', { name: 'Open the exchange' })
  const linkTarget = exchangeLink.getAttribute('href')
  expect(linkTarget).toContain('/exchange-thread?claim=')
  expect(linkTarget).toContain('claim-12')
})

test('shows the empty state when the member has no notifications', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, { notifications: [], unread_count: 0 })
  })

  renderNotificationsPage()

  expect(await screen.findByText(/You have no notifications yet/)).toBeTruthy()
  expect(screen.queryAllByRole('listitem').length).toBe(0)
})

test('treats a response missing the notifications list as empty', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, { unread_count: 0 })
  })

  renderNotificationsPage()

  expect(await screen.findByText(/You have no notifications yet/)).toBeTruthy()
})

test('shows the backend error detail when the load is refused', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 403, { detail: 'Your account is suspended, so you cannot view notifications.' })
  })

  renderNotificationsPage()

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Your account is suspended')
})

test('shows the service error message when the request itself fails', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  renderNotificationsPage()

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Request failed')
})

test('shows the not-logged-in message and calls no service without a member', () => {
  const fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)

  renderNotificationsPage()

  expect(screen.getByRole('alert').textContent).toContain('You need to be logged in')
  expect(fetchSpy).not.toHaveBeenCalled()
})

test('a stale session clears the stored login and shows the login message', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 401, { detail: 'Not authenticated. Unknown member.' })
  })

  renderNotificationsPage()

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('You need to be logged in')
  expect(window.localStorage.getItem('memberId')).toBeNull()
  expect(window.localStorage.getItem('memberName')).toBeNull()
  expect(window.localStorage.getItem('memberEmail')).toBeNull()
})
