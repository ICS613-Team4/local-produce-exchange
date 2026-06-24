import { afterEach, expect, test, vi } from 'vitest'

import {
  requestQueueTimeoutMilliseconds,
  sendGetMyRequestsRequest,
  sendGetRequestQueuesRequest,
} from './requestQueueService'

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

test('gets the request queues with the member id header and parses a JSON response', async () => {
  const responseBody = {
    groups: [
      {
        listing_id: 'l1',
        listing_title: 'Lemons',
        listing_status: 'active',
        remaining_quantity: 4,
        pending: [],
      },
    ],
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

  const result = await sendGetRequestQueuesRequest('member-123', '')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
  // With no listing id, the URL carries no query string at all.
  expect(requestUrl).toBe('/api/request-queues')
  expect(requestOptions.method).toBe('GET')
  // The member id rides in the X-Member-Id header.
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
  // The timeout signal must be present so the function can't silently drop it.
  expect(requestOptions.signal).toBeTruthy()
})

test('appends the listing id as a query param when given one', async () => {
  let requestUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    requestUrl = String(url)
    return makeFakeResponse(true, 200, JSON.stringify({ groups: [] }))
  })

  await sendGetRequestQueuesRequest('member-123', 'listing-abc')

  // The filtered call carries the listing id as ?listing=<id>.
  expect(requestUrl).toBe('/api/request-queues?listing=listing-abc')
})

test('maps an HTTP error response into the result object', async () => {
  const responseBody = {
    detail: 'You can only view requests for your own listings.',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 403, JSON.stringify(responseBody))
  })

  const result = await sendGetRequestQueuesRequest('member-123', 'listing-abc')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(403)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
})

test('keeps a plain text response body', async () => {
  // A proxy or server problem can return non-JSON text; the function keeps the
  // status and the raw body instead of throwing the parse error away.
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 502, 'Bad Gateway')
  })

  const result = await sendGetRequestQueuesRequest('member-123', '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(502)
  expect(result.data).toBe('Bad Gateway')
  expect(result.errorMessage).toBe('')
})

test('keeps an empty response body as an empty string', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 204, '')
  })

  const result = await sendGetRequestQueuesRequest('member-123', '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(204)
  expect(result.data).toBe('')
  expect(result.errorMessage).toBe('')
})

test('returns the HTTP status unchanged on a 401', async () => {
  // The page decides what to do with a 401; the service just reports the status.
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 401, JSON.stringify({ detail: 'Not authenticated.' }))
  })

  const result = await sendGetRequestQueuesRequest('member-123', '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(401)
})

test('returns a timeout message when the request times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendGetRequestQueuesRequest('member-123', '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + requestQueueTimeoutMilliseconds + ' ms.',
  )
})

test('returns a request failure message when fetch rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  const result = await sendGetRequestQueuesRequest('member-123', '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe('Request failed: TypeError: Failed to fetch')
})

// --- sendGetMyRequestsRequest: the outgoing view ---

test('gets my requests at /api/my-requests with the member id header', async () => {
  const responseBody = { groups: [] }
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) {
      requestOptions = options
    }
    return makeFakeResponse(true, 200, JSON.stringify(responseBody))
  })

  const result = await sendGetMyRequestsRequest('member-123')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
  // No filter, so the URL has no query string.
  expect(requestUrl).toBe('/api/my-requests')
  expect(requestOptions.method).toBe('GET')
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
  expect(requestOptions.signal).toBeTruthy()
})

test('my requests maps an HTTP error response into the result object', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 403, JSON.stringify({ detail: 'denied' }))
  })

  const result = await sendGetMyRequestsRequest('member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(403)
})

test('my requests returns a timeout message when the request times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendGetMyRequestsRequest('member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + requestQueueTimeoutMilliseconds + ' ms.',
  )
})

test('my requests returns a request failure message when fetch rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  const result = await sendGetMyRequestsRequest('member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe('Request failed: TypeError: Failed to fetch')
})
