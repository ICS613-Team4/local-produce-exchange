// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import NotificationsPage from './NotificationsPage'
import { notificationsChangedEventName } from '../services/notificationService'

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

// The stub routes stand in for the pages the row links navigate to, so a
// link-click test can assert the navigation landed without pulling in the
// real pages.
function renderNotificationsPage() {
  render(
    <MemoryRouter initialEntries={['/notifications']}>
      <Routes>
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/requests" element={<p>incoming requests page stub</p>} />
        <Route path="/exchange-thread" element={<p>exchange thread page stub</p>} />
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
  // The requester cancelling an approved exchange locks its thread, but the
  // poster's notification still links there: the thread stays readable
  // as history even though sending is closed.
  setLoggedIn()
  const body = {
    notifications: [
      {
        id: 'n9',
        claim_id: 'claim-12',
        kind: 'request_cancelled',
        message: "Carol Chen cancelled their approved request on your listing 'Thai Basil'.",
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

// ── marking a notification read (US-23) ──────────────────────────────────────

// One notification, in whichever read state and kind a test needs. The default
// kind links to the exchange thread, so link-click tests work out of the box.
function makeSingleNotificationBody(isRead: boolean, kind: string, claimId: string | null) {
  const body = {
    notifications: [
      {
        id: 'n1',
        claim_id: claimId,
        kind: kind,
        message: 'Carol sent you a message about your listing.',
        is_read: isRead,
        created_at: '2026-07-02T10:00:00.000Z',
      },
    ],
    unread_count: 1,
  }
  return body
}

// A fake response whose body is plain text, not JSON, for the fallback-message
// path (a proxy or server error page).
function makePlainTextResponse(status: number, bodyText: string): FakeResponse {
  const fakeResponse = {
    ok: false,
    status: status,
    text: async () => {
      return bodyText
    },
  }
  return fakeResponse
}

// Routes the stubbed fetch by URL. A mark-read PATCH answers with markResponse
// and is recorded; the notifications list GET answers with listBody until a
// mark has been recorded, then with listBodyAfterMark, so a successful mark's
// reload shows the row flipped to read. Returns the recorded mark calls.
function stubListAndMarkFetch(
  listBody: object,
  listBodyAfterMark: object,
  markResponse: FakeResponse,
) {
  const markCalls: { url: string; method: string; headersText: string }[] = []
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    const urlText = String(url)
    if (urlText.endsWith('/read')) {
      let method = ''
      let headersText = ''
      if (options !== undefined) {
        method = String(options.method)
        headersText = JSON.stringify(options.headers)
      }
      markCalls.push({ url: urlText, method: method, headersText: headersText })
      return markResponse
    }
    if (markCalls.length > 0) {
      return makeFakeResponse(true, 200, listBodyAfterMark)
    }
    return makeFakeResponse(true, 200, listBody)
  })
  return markCalls
}

test('unread and read notifications render differently', async () => {
  setLoggedIn()
  const body = {
    notifications: [
      {
        id: 'n-unread',
        claim_id: 'claim-1',
        kind: 'request_approved',
        message: 'Your request was approved.',
        is_read: false,
        created_at: '2026-07-02T10:00:00.000Z',
      },
      {
        id: 'n-read',
        claim_id: 'claim-2',
        kind: 'request_approved',
        message: 'An older approval you already saw.',
        is_read: true,
        created_at: '2026-07-01T10:00:00.000Z',
      },
    ],
    unread_count: 1,
  }
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, body))

  renderNotificationsPage()

  // The unread message is bold; the read message is not.
  const unreadMessage = await screen.findByText('Your request was approved.')
  expect(unreadMessage.className).toContain('font-bold')
  const readMessage = screen.getByText('An older approval you already saw.')
  expect(readMessage.className).not.toContain('font-bold')

  // The labels tell the two states apart, and only the unread row has the
  // mark-as-read button.
  const rows = screen.getAllByRole('listitem')
  expect(rows[0].textContent).toContain('[Unread]')
  expect(rows[1].textContent).toContain('[Read]')
  const markButtons = screen.getAllByRole('button', { name: 'Mark as read' })
  expect(markButtons.length).toBe(1)
  expect(rows[1].textContent).not.toContain('Mark as read')
})

test('clicking Mark as read marks the notification and re-renders it as read', async () => {
  setLoggedIn()
  const unreadBody = makeSingleNotificationBody(false, 'request_approved', 'claim-1')
  const readBody = makeSingleNotificationBody(true, 'request_approved', 'claim-1')
  const markResponse = makeFakeResponse(true, 200, {
    id: 'n1',
    is_read: true,
    read_at: '2026-07-18T09:00:00.000Z',
  })
  const markCalls = stubListAndMarkFetch(unreadBody, readBody, markResponse)

  renderNotificationsPage()

  const markButton = await screen.findByRole('button', { name: 'Mark as read' })
  markButton.click()

  // The call carried the member id and hit this notification's mark URL.
  await waitFor(() => {
    expect(markCalls.length).toBe(1)
  })
  expect(markCalls[0].url).toBe('/api/notifications/n1/read')
  expect(markCalls[0].method).toBe('PATCH')
  expect(markCalls[0].headersText).toContain('bob')

  // The reload flipped the row to read on screen: normal weight, [Read] label,
  // no button, without a full page reload.
  await screen.findByText('[Read]')
  expect(screen.queryByRole('button', { name: 'Mark as read' })).toBeNull()
})

test('the Mark as read button is disabled while the call is in flight', async () => {
  setLoggedIn()
  const unreadBody = makeSingleNotificationBody(false, 'request_approved', 'claim-1')
  const readBody = makeSingleNotificationBody(true, 'request_approved', 'claim-1')
  let releaseMark: ((value: FakeResponse) => void) | null = null
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.endsWith('/read')) {
      return new Promise<FakeResponse>((resolve) => {
        releaseMark = resolve
      })
    }
    if (releaseMark !== null) {
      return makeFakeResponse(true, 200, readBody)
    }
    return makeFakeResponse(true, 200, unreadBody)
  })

  renderNotificationsPage()

  const markButton = await screen.findByRole('button', { name: 'Mark as read' })
  await act(async () => {
    markButton.click()
  })

  // While the mark is in flight, this row's button is disabled.
  expect((screen.getByRole('button', { name: 'Mark as read' }) as HTMLButtonElement).disabled).toBe(true)

  // Release the held response; the row flips to read and the button is gone.
  await act(async () => {
    if (releaseMark !== null) {
      releaseMark(makeFakeResponse(true, 200, { id: 'n1', is_read: true, read_at: '2026-07-18T09:00:00.000Z' }))
    }
  })
  await screen.findByText('[Read]')
  expect(screen.queryByRole('button', { name: 'Mark as read' })).toBeNull()
})

test('a double click in the same tick sends only one mark request', async () => {
  setLoggedIn()
  const unreadBody = makeSingleNotificationBody(false, 'request_approved', 'claim-1')
  const readBody = makeSingleNotificationBody(true, 'request_approved', 'claim-1')
  const markResponse = makeFakeResponse(true, 200, {
    id: 'n1',
    is_read: true,
    read_at: '2026-07-18T09:00:00.000Z',
  })
  const markCalls = stubListAndMarkFetch(unreadBody, readBody, markResponse)

  renderNotificationsPage()

  const markButton = await screen.findByRole('button', { name: 'Mark as read' })
  // Both clicks land before React re-renders the button as disabled, so the
  // second one is stopped by the in-flight ref, not by the disabled state.
  await act(async () => {
    markButton.click()
    markButton.click()
  })

  await screen.findByText('[Read]')
  expect(markCalls.length).toBe(1)
})

test('clicking the incoming-requests link on an unread row marks it read too', async () => {
  setLoggedIn()
  const unreadBody = makeSingleNotificationBody(false, 'request_submitted', 'claim-7')
  const readBody = makeSingleNotificationBody(true, 'request_submitted', 'claim-7')
  const markResponse = makeFakeResponse(true, 200, {
    id: 'n1',
    is_read: true,
    read_at: '2026-07-18T09:00:00.000Z',
  })
  const markCalls = stubListAndMarkFetch(unreadBody, readBody, markResponse)

  renderNotificationsPage()

  const requestsLink = await screen.findByRole('link', { name: 'Open your incoming requests' })
  requestsLink.click()

  await screen.findByText('incoming requests page stub')
  await waitFor(() => {
    expect(markCalls.length).toBe(1)
  })
  expect(markCalls[0].url).toBe('/api/notifications/n1/read')
})

test('a successful mark fires the notifications-changed event', async () => {
  setLoggedIn()
  const unreadBody = makeSingleNotificationBody(false, 'request_approved', 'claim-1')
  const readBody = makeSingleNotificationBody(true, 'request_approved', 'claim-1')
  const markResponse = makeFakeResponse(true, 200, {
    id: 'n1',
    is_read: true,
    read_at: '2026-07-18T09:00:00.000Z',
  })
  stubListAndMarkFetch(unreadBody, readBody, markResponse)
  const eventSpy = vi.fn()
  window.addEventListener(notificationsChangedEventName, eventSpy)

  renderNotificationsPage()

  const markButton = await screen.findByRole('button', { name: 'Mark as read' })
  markButton.click()

  // This event is what tells the header bell to re-read its count right away.
  await waitFor(() => {
    expect(eventSpy).toHaveBeenCalledTimes(1)
  })

  window.removeEventListener(notificationsChangedEventName, eventSpy)
})

test('a failed mark alerts the backend detail and fires no event', async () => {
  setLoggedIn()
  const unreadBody = makeSingleNotificationBody(false, 'request_approved', 'claim-1')
  const markResponse = makeFakeResponse(false, 403, {
    detail: 'You can only mark your own notifications read.',
  })
  stubListAndMarkFetch(unreadBody, unreadBody, markResponse)
  const alertSpy = vi.fn()
  vi.stubGlobal('alert', alertSpy)
  const eventSpy = vi.fn()
  window.addEventListener(notificationsChangedEventName, eventSpy)

  renderNotificationsPage()

  const markButton = await screen.findByRole('button', { name: 'Mark as read' })
  markButton.click()

  await waitFor(() => {
    expect(alertSpy).toHaveBeenCalledWith('You can only mark your own notifications read.')
  })
  // A failed mark changed no row, so the header is not told to re-read.
  expect(eventSpy).not.toHaveBeenCalled()
  // The row is still unread and the button is back for another try.
  expect(screen.getByText('[Unread]')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Mark as read' }) as HTMLButtonElement).disabled).toBe(false)

  window.removeEventListener(notificationsChangedEventName, eventSpy)
})

test('a network failure on the button path alerts the request-failed message', async () => {
  setLoggedIn()
  const unreadBody = makeSingleNotificationBody(false, 'request_approved', 'claim-1')
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.endsWith('/read')) {
      throw new TypeError('Failed to fetch')
    }
    return makeFakeResponse(true, 200, unreadBody)
  })
  const alertSpy = vi.fn()
  vi.stubGlobal('alert', alertSpy)

  renderNotificationsPage()

  const markButton = await screen.findByRole('button', { name: 'Mark as read' })
  markButton.click()

  await waitFor(() => {
    expect(alertSpy).toHaveBeenCalledTimes(1)
  })
  const alertText = String(alertSpy.mock.calls[0][0])
  expect(alertText).toContain('Request failed')
})

test('a non-JSON failure body falls back to the generic message', async () => {
  setLoggedIn()
  const unreadBody = makeSingleNotificationBody(false, 'request_approved', 'claim-1')
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.endsWith('/read')) {
      return makePlainTextResponse(500, 'Internal Server Error')
    }
    return makeFakeResponse(true, 200, unreadBody)
  })
  const alertSpy = vi.fn()
  vi.stubGlobal('alert', alertSpy)

  renderNotificationsPage()

  const markButton = await screen.findByRole('button', { name: 'Mark as read' })
  markButton.click()

  await waitFor(() => {
    expect(alertSpy).toHaveBeenCalledWith('Could not mark the notification read. Please try again.')
  })
})

test('a stale session on the mark path clears the stored login', async () => {
  setLoggedIn()
  const unreadBody = makeSingleNotificationBody(false, 'request_approved', 'claim-1')
  const markResponse = makeFakeResponse(false, 401, {
    detail: 'Not authenticated. Unknown member.',
  })
  stubListAndMarkFetch(unreadBody, unreadBody, markResponse)
  const alertSpy = vi.fn()
  vi.stubGlobal('alert', alertSpy)

  renderNotificationsPage()

  const markButton = await screen.findByRole('button', { name: 'Mark as read' })
  markButton.click()

  // The page flips to the login message instead of alerting a raw detail.
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('You need to be logged in')
  expect(window.localStorage.getItem('memberId')).toBeNull()
  expect(alertSpy).not.toHaveBeenCalled()
})

test('clicking the link on an unread row marks it read too', async () => {
  setLoggedIn()
  const unreadBody = makeSingleNotificationBody(false, 'pickup_confirmed', 'claim-9')
  const readBody = makeSingleNotificationBody(true, 'pickup_confirmed', 'claim-9')
  const markResponse = makeFakeResponse(true, 200, {
    id: 'n1',
    is_read: true,
    read_at: '2026-07-18T09:00:00.000Z',
  })
  const markCalls = stubListAndMarkFetch(unreadBody, readBody, markResponse)

  renderNotificationsPage()

  const exchangeLink = await screen.findByRole('link', { name: 'Open the exchange' })
  exchangeLink.click()

  // The navigation landed on the thread page, and the mark fired for this
  // notification with the member id.
  await screen.findByText('exchange thread page stub')
  await waitFor(() => {
    expect(markCalls.length).toBe(1)
  })
  expect(markCalls[0].url).toBe('/api/notifications/n1/read')
  expect(markCalls[0].headersText).toContain('bob')
})

test('clicking the link on a read row marks nothing', async () => {
  setLoggedIn()
  const readBody = makeSingleNotificationBody(true, 'pickup_confirmed', 'claim-9')
  const markResponse = makeFakeResponse(true, 200, { id: 'n1', is_read: true, read_at: null })
  const markCalls = stubListAndMarkFetch(readBody, readBody, markResponse)

  renderNotificationsPage()

  const exchangeLink = await screen.findByRole('link', { name: 'Open the exchange' })
  exchangeLink.click()

  // The navigation still happens, but a read row has nothing to mark, so no
  // pointless write is sent.
  await screen.findByText('exchange thread page stub')
  await act(async () => {})
  expect(markCalls.length).toBe(0)
})

test('the link navigates right away even when the mark never answers', async () => {
  setLoggedIn()
  const unreadBody = makeSingleNotificationBody(false, 'pickup_confirmed', 'claim-9')
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.endsWith('/read')) {
      // Never answers. If the handler ever awaits the mark before letting the
      // navigation through, this test hangs and fails.
      return new Promise<FakeResponse>(() => {})
    }
    return makeFakeResponse(true, 200, unreadBody)
  })

  renderNotificationsPage()

  const exchangeLink = await screen.findByRole('link', { name: 'Open the exchange' })
  exchangeLink.click()

  await screen.findByText('exchange thread page stub')
})

test('a failed link mark shows no alert, while the button path alerts', async () => {
  setLoggedIn()
  const unreadBody = makeSingleNotificationBody(false, 'pickup_confirmed', 'claim-9')
  const markResponse = makeFakeResponse(false, 403, {
    detail: 'You can only mark your own notifications read.',
  })
  const alertSpy = vi.fn()
  vi.stubGlobal('alert', alertSpy)

  // Link path: the member asked to navigate, so the failure stays silent.
  const linkMarkCalls = stubListAndMarkFetch(unreadBody, unreadBody, markResponse)
  renderNotificationsPage()
  const exchangeLink = await screen.findByRole('link', { name: 'Open the exchange' })
  exchangeLink.click()
  await screen.findByText('exchange thread page stub')
  await waitFor(() => {
    expect(linkMarkCalls.length).toBe(1)
  })
  await act(async () => {})
  expect(alertSpy).not.toHaveBeenCalled()

  // Button path: the member asked for the mark, so the same failure alerts.
  cleanup()
  const buttonMarkCalls = stubListAndMarkFetch(unreadBody, unreadBody, markResponse)
  renderNotificationsPage()
  const markButton = await screen.findByRole('button', { name: 'Mark as read' })
  markButton.click()
  await waitFor(() => {
    expect(buttonMarkCalls.length).toBe(1)
  })
  await waitFor(() => {
    expect(alertSpy).toHaveBeenCalledWith('You can only mark your own notifications read.')
  })
})
