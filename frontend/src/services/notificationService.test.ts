import { afterEach, expect, test, vi } from 'vitest'

import {
  notificationTimeoutMilliseconds,
  sendGetNotificationsRequest,
  sendGetUnreadCountRequest,
  sendMarkNotificationReadRequest,
} from './notificationService'

type FakeResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// Builds a fake fetch result with only the members the service reads.
function makeFakeResponse(ok: boolean, status: number, bodyText: string): FakeResponse {
  const fakeResponse = {
    ok: ok,
    status: status,
    text: async () => {
      return bodyText
    },
  }
  return fakeResponse
}

// ── sendGetNotificationsRequest ──────────────────────────────────────────────

test('list request sends the member header and parses a JSON response', async () => {
  const responseBody = {
    notifications: [
      {
        id: 'n1',
        claim_id: 'c1',
        kind: 'request_submitted',
        message: 'Carol requested 1 of your listing.',
        is_read: false,
        created_at: '2026-07-01T09:00:00.000Z',
      },
    ],
    unread_count: 1,
  }
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) {
      requestOptions = options
    }
    return makeFakeResponse(true, 200, JSON.stringify(responseBody))
  })

  const result = await sendGetNotificationsRequest('member-123')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
  expect(requestUrl).toBe('/api/notifications')
  expect(requestOptions.method).toBe('GET')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
  expect(requestOptions.signal).toBeTruthy()
})

test('list request surfaces a non-OK status and keeps the body', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 403, JSON.stringify({ detail: 'suspended' }))
  })

  const result = await sendGetNotificationsRequest('member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(403)
  expect(JSON.stringify(result.data)).toContain('suspended')
  expect(result.errorMessage).toBe('')
})

test('list request keeps a plain text response body', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 502, 'Bad Gateway')
  })

  const result = await sendGetNotificationsRequest('member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(502)
  expect(result.data).toBe('Bad Gateway')
})

test('list request returns a timeout message when fetch times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendGetNotificationsRequest('member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + notificationTimeoutMilliseconds + ' ms.',
  )
})

test('list request returns a failure message when fetch rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  const result = await sendGetNotificationsRequest('member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe('Request failed: TypeError: Failed to fetch')
})

// ── sendGetUnreadCountRequest ────────────────────────────────────────────────

test('count request calls the count-only endpoint, not the list endpoint', async () => {
  // A wrong URL here would silently reintroduce polling the full list every
  // fifteen seconds, so the exact path is pinned.
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) {
      requestOptions = options
    }
    return makeFakeResponse(true, 200, JSON.stringify({ unread_count: 2 }))
  })

  const result = await sendGetUnreadCountRequest('member-123')

  expect(result.ok).toBe(true)
  expect(requestUrl).toBe('/api/notifications/unread-count')
  expect(requestUrl).not.toBe('/api/notifications')
  expect(requestOptions.method).toBe('GET')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
})

test('count request parses the count body', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, JSON.stringify({ unread_count: 7 }))
  })

  const result = await sendGetUnreadCountRequest('member-123')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  const body = result.data as { unread_count: number }
  expect(body.unread_count).toBe(7)
})

test('count request surfaces a non-OK status', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 401, JSON.stringify({ detail: 'Not authenticated.' }))
  })

  const result = await sendGetUnreadCountRequest('member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(401)
})

test('count request keeps a plain text response body', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 502, 'Bad Gateway')
  })

  const result = await sendGetUnreadCountRequest('member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(502)
  expect(result.data).toBe('Bad Gateway')
})

test('count request returns a timeout message when fetch times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendGetUnreadCountRequest('member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + notificationTimeoutMilliseconds + ' ms.',
  )
})

test('count request returns a failure message when fetch rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  const result = await sendGetUnreadCountRequest('member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe('Request failed: TypeError: Failed to fetch')
})

// ── sendMarkNotificationReadRequest (US-23) ──────────────────────────────────

test('mark-read request sends a PATCH with the member header and parses the body', async () => {
  const responseBody = {
    id: 'notif-1',
    is_read: true,
    read_at: '2026-07-18T09:00:00.000Z',
  }
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) {
      requestOptions = options
    }
    return makeFakeResponse(true, 200, JSON.stringify(responseBody))
  })

  const result = await sendMarkNotificationReadRequest('member-123', 'notif-1')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
  expect(requestUrl).toBe('/api/notifications/notif-1/read')
  expect(requestOptions.method).toBe('PATCH')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
  expect(requestOptions.signal).toBeTruthy()
})

test('mark-read request surfaces a non-OK status and keeps the body', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(
      false,
      403,
      JSON.stringify({ detail: 'You can only mark your own notifications read.' }),
    )
  })

  const result = await sendMarkNotificationReadRequest('member-123', 'notif-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(403)
  expect(JSON.stringify(result.data)).toContain('your own notifications')
  expect(result.errorMessage).toBe('')
})

test('mark-read request keeps a plain text response body', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 502, 'Bad Gateway')
  })

  const result = await sendMarkNotificationReadRequest('member-123', 'notif-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(502)
  expect(result.data).toBe('Bad Gateway')
})

test('mark-read request returns a timeout message when fetch times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendMarkNotificationReadRequest('member-123', 'notif-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + notificationTimeoutMilliseconds + ' ms.',
  )
})

test('mark-read request returns a failure message when fetch rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  const result = await sendMarkNotificationReadRequest('member-123', 'notif-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe('Request failed: TypeError: Failed to fetch')
})
