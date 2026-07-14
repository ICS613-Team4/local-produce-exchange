import { afterEach, expect, test, vi } from 'vitest'

import {
  requestQueueTimeoutMilliseconds,
  sendCancelExchangeRequest,
  sendCompleteExchangeRequest,
  sendConfirmPickupRequest,
  sendCreateClaimRequest,
  sendDecideClaimRequest,
  sendGetAllRequestsRequest,
  sendGetMyClaimRequest,
  sendGetMyRequestsRequest,
  sendGetRequestQueuesRequest,
  sendWithdrawClaimRequest,
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

// --- sendCreateClaimRequest: submitting a request ---

test('creates a claim with a POST, the quantity body, and the member id header', async () => {
  const responseBody = {
    id: 'claim-1',
    listing_id: 'listing-abc',
    claimant_id: 'member-123',
    requested_quantity: 3,
    status: 'requested',
    requested_at: '2026-07-01T09:00:00.000Z',
  }
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) {
      requestOptions = options
    }
    return makeFakeResponse(true, 201, JSON.stringify(responseBody))
  })

  const result = await sendCreateClaimRequest('listing-abc', 'member-123', 3)

  expect(result.ok).toBe(true)
  expect(result.status).toBe(201)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  // The POST goes to the listing's claims path.
  expect(requestUrl).toBe('/api/listings/listing-abc/claims')
  expect(requestOptions.method).toBe('POST')
  // The quantity travels in the JSON body.
  expect(requestOptions.body).toBe(JSON.stringify({ quantity: 3 }))
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
  expect(JSON.stringify(requestOptions.headers)).toContain('application/json')
  expect(requestOptions.signal).toBeTruthy()
})

test('create claim maps a 409 duplicate response into the result object', async () => {
  const responseBody = { detail: 'You have already made a request on this listing.' }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 409, JSON.stringify(responseBody))
  })

  const result = await sendCreateClaimRequest('listing-abc', 'member-123', 3)

  expect(result.ok).toBe(false)
  expect(result.status).toBe(409)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
})

test('create claim returns a timeout message when the request times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendCreateClaimRequest('listing-abc', 'member-123', 3)

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + requestQueueTimeoutMilliseconds + ' ms.',
  )
})

// --- sendDecideClaimRequest: approve / deny ---

test('approve sends a PATCH to the approve path with the member id header', async () => {
  const responseBody = {
    id: 'claim-1',
    listing_id: 'l1',
    claimant_id: 'm1',
    requested_quantity: 3,
    approved_quantity: 3,
    status: 'approved',
    requested_at: '2026-07-01T09:00:00.000Z',
    approved_at: '2026-07-01T12:00:00.000Z',
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

  const result = await sendDecideClaimRequest('member-123', 'claim-1', 'approve')

  expect(result.ok).toBe(true)
  expect(requestUrl).toBe('/api/claims/claim-1/approve')
  expect(requestOptions.method).toBe('PATCH')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
})

test('deny sends a PATCH to the deny path', async () => {
  let requestUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    requestUrl = String(url)
    return makeFakeResponse(true, 200, JSON.stringify({ status: 'denied' }))
  })

  await sendDecideClaimRequest('member-123', 'claim-1', 'deny')

  expect(requestUrl).toBe('/api/claims/claim-1/deny')
})

// --- sendGetMyClaimRequest: the viewer's own claim on a listing ---

test('gets my claim at the listing my-claim path with the member id header', async () => {
  const responseBody = {
    id: 'claim-1',
    listing_id: 'listing-abc',
    claimant_id: 'member-123',
    requested_quantity: 3,
    status: 'requested',
    requested_at: '2026-07-01T09:00:00.000Z',
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

  const result = await sendGetMyClaimRequest('listing-abc', 'member-123')

  expect(result.ok).toBe(true)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(requestUrl).toBe('/api/listings/listing-abc/my-claim')
  expect(requestOptions.method).toBe('GET')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
})

test('my claim parses a null body as null data when there is no request', async () => {
  // The endpoint returns JSON null when the viewer has not requested the listing.
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, 'null')
  })

  const result = await sendGetMyClaimRequest('listing-abc', 'member-123')

  expect(result.ok).toBe(true)
  expect(result.data).toBe(null)
})

// --- US-24: sendWithdrawClaimRequest withdraws a pending request ---

test('withdraw sends a PATCH to the withdraw path with the member id header and no body', async () => {
  const responseBody = {
    id: 'claim-1',
    listing_id: 'l1',
    claimant_id: 'member-123',
    requested_quantity: 3,
    status: 'cancelled',
    requested_at: '2026-07-01T09:00:00.000Z',
    cancelled_at: '2026-07-02T10:00:00.000Z',
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

  const result = await sendWithdrawClaimRequest('member-123', 'claim-1')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(requestUrl).toBe('/api/claims/claim-1/withdraw')
  expect(requestOptions.method).toBe('PATCH')
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
  expect(requestOptions.signal).toBeTruthy()
  // The withdraw call sends no request body.
  expect(requestOptions.body).toBeUndefined()
})

test('confirm pickup sends a PATCH to the pickup path with the member id header and no body', async () => {
  const responseBody = {
    id: 'claim-1',
    listing_id: 'l1',
    claimant_id: 'member-123',
    requested_quantity: 3,
    approved_quantity: 3,
    status: 'picked_up',
    requested_at: '2026-07-01T09:00:00.000Z',
    approved_at: '2026-07-01T12:00:00.000Z',
    picked_up_at: '2026-07-01T13:00:00.000Z',
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

  const result = await sendConfirmPickupRequest('member-123', 'claim-1')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(requestUrl).toBe('/api/claims/claim-1/pickup')
  expect(requestOptions.method).toBe('PATCH')
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
  expect(requestOptions.signal).toBeTruthy()
  expect(requestOptions.body).toBeUndefined()
})

test('confirm pickup maps an HTTP error response into the result object', async () => {
  const responseBody = { detail: 'Only an approved request can be marked as picked up.' }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 409, JSON.stringify(responseBody))
  })

  const result = await sendConfirmPickupRequest('member-123', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(409)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
})

test('cancel sends a PATCH to the cancel path with the member id header', async () => {
  const responseBody = {
    id: 'claim-1',
    status: 'cancelled',
    cancelled_at: '2026-07-01T14:00:00.000Z',
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

  const result = await sendCancelExchangeRequest('member-123', 'claim-1')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(requestUrl).toBe('/api/claims/claim-1/cancel')
  expect(requestOptions.method).toBe('PATCH')
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
  expect(requestOptions.body).toBeUndefined()
})

test('cancel maps an HTTP error response into the result object', async () => {
  const responseBody = {
    detail: 'This exchange is not approved, so it cannot be cancelled.',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 409, JSON.stringify(responseBody))
  })

  const result = await sendCancelExchangeRequest('member-123', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(409)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
})

test('cancel returns a timeout message when the request times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendCancelExchangeRequest('member-123', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + requestQueueTimeoutMilliseconds + ' ms.',
  )
})

test('cancel returns a request failure message when fetch rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('network down')
  })

  const result = await sendCancelExchangeRequest('member-123', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toContain('network down')
})

test('complete sends a PATCH to the complete path with the member id header', async () => {
  const responseBody = {
    id: 'claim-1',
    status: 'completed',
    completed_at: '2026-07-01T14:00:00.000Z',
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

  const result = await sendCompleteExchangeRequest('member-123', 'claim-1')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(requestUrl).toBe('/api/claims/claim-1/complete')
  expect(requestOptions.method).toBe('PATCH')
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
  expect(requestOptions.body).toBeUndefined()
})

test('complete maps an HTTP error response into the result object', async () => {
  const responseBody = {
    detail: 'This exchange is not picked up, so it cannot be completed.',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 409, JSON.stringify(responseBody))
  })

  const result = await sendCompleteExchangeRequest('member-123', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(409)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
})

test('complete returns a timeout message when the request times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendCompleteExchangeRequest('member-123', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + requestQueueTimeoutMilliseconds + ' ms.',
  )
})

test('complete keeps a plain text error response body', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 502, 'Bad gateway')
  })

  const result = await sendCompleteExchangeRequest('member-123', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(502)
  expect(result.data).toBe('Bad gateway')
})

test('complete returns a request failure message when fetch rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('network down')
  })

  const result = await sendCompleteExchangeRequest('member-123', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toContain('network down')
})

test('withdraw maps an HTTP error response into the result object', async () => {
  const responseBody = { detail: 'This request is not pending, so it cannot be withdrawn.' }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 409, JSON.stringify(responseBody))
  })

  const result = await sendWithdrawClaimRequest('member-123', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(409)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
})

test('withdraw returns a timeout message when the request times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendWithdrawClaimRequest('member-123', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + requestQueueTimeoutMilliseconds + ' ms.',
  )
})

// --- US-24: sendGetAllRequestsRequest lists every request per active listing ---

test('gets all requests at /api/request-queues/all with the member id header', async () => {
  const responseBody = {
    groups: [
      {
        listing_id: 'l1',
        listing_title: 'Lemons',
        remaining_quantity: 4,
        requests: [],
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

  const result = await sendGetAllRequestsRequest('member-123', '')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
  // With no listing id, the URL carries no query string.
  expect(requestUrl).toBe('/api/request-queues/all')
  expect(requestOptions.method).toBe('GET')
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
  expect(requestOptions.signal).toBeTruthy()
})

test('all requests appends the listing id as a query param when given one', async () => {
  let requestUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    requestUrl = String(url)
    return makeFakeResponse(true, 200, JSON.stringify({ groups: [] }))
  })

  await sendGetAllRequestsRequest('member-123', 'listing-abc')

  expect(requestUrl).toBe('/api/request-queues/all?listing=listing-abc')
})

test('all requests maps an HTTP error response into the result object', async () => {
  const responseBody = { detail: 'You can only view requests for your own listings.' }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 403, JSON.stringify(responseBody))
  })

  const result = await sendGetAllRequestsRequest('member-123', 'listing-abc')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(403)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
})

test('all requests returns a timeout message when the request times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendGetAllRequestsRequest('member-123', '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + requestQueueTimeoutMilliseconds + ' ms.',
  )
})
