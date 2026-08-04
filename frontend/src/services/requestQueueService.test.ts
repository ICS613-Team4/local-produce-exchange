import { afterEach, expect, test, vi } from 'vitest'

import {
  requestQueueTimeoutMilliseconds,
  sendCancelExchangeRequest,
  sendCompleteExchangeRequest,
  sendConfirmPickupRequest,
  sendCreateClaimRequest,
  sendDecideClaimRequest,
  sendGetAllRequestsRequest,
  sendGetExchangeHistoryRequest,
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
  // With no section pages named, only the shared page size is sent, so every
  // section stays on its first page.
  expect(requestUrl).toBe('/api/my-requests?page_size=12')
  expect(requestOptions.method).toBe('GET')
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
  expect(requestOptions.signal).toBeTruthy()
})

// --- US-33: each my-requests section carries its own page number ---

test('my requests sends one page param per named section', async () => {
  let requestUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    requestUrl = String(url)
    return makeFakeResponse(true, 200, JSON.stringify({}))
  })

  await sendGetMyRequestsRequest('member-123', {
    pending: 2,
    approved: 1,
    completed: 4,
    denied: 1,
    withdrawn: 3,
  })

  expect(requestUrl).toContain('pending_page=2')
  expect(requestUrl).toContain('approved_page=1')
  expect(requestUrl).toContain('completed_page=4')
  expect(requestUrl).toContain('denied_page=1')
  expect(requestUrl).toContain('withdrawn_page=3')
  expect(requestUrl).toContain('page_size=12')
})

test('my requests leaves out the sections it was not given', async () => {
  // A section with no page of its own sends no param, so the backend leaves it
  // on page 1 and the other sections are unaffected.
  let requestUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    requestUrl = String(url)
    return makeFakeResponse(true, 200, JSON.stringify({}))
  })

  await sendGetMyRequestsRequest('member-123', { pending: 3 })

  expect(requestUrl).toContain('pending_page=3')
  expect(requestUrl).not.toContain('approved_page')
  expect(requestUrl).not.toContain('completed_page')
  expect(requestUrl).not.toContain('denied_page')
  expect(requestUrl).not.toContain('withdrawn_page')
})

test('my requests sends the page size it was given', async () => {
  let requestUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    requestUrl = String(url)
    return makeFakeResponse(true, 200, JSON.stringify({}))
  })

  await sendGetMyRequestsRequest('member-123', {}, 100)

  expect(requestUrl).toBe('/api/my-requests?page_size=100')
})

test('my requests hands back each section as its own paged envelope', async () => {
  const responseBody = {
    pending: { items: [{ id: 'c1' }], total: 20, page: 2, page_size: 12 },
    approved: { items: [], total: 0, page: 1, page_size: 12 },
    completed: { items: [], total: 0, page: 1, page_size: 12 },
    denied: { items: [], total: 0, page: 1, page_size: 12 },
    withdrawn: { items: [], total: 0, page: 1, page_size: 12 },
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, JSON.stringify(responseBody))
  })

  const result = await sendGetMyRequestsRequest('member-123', { pending: 2 })

  const data = result.data as {
    pending: { items: unknown[]; total: number; page: number }
    approved: { total: number; page: number }
  }
  expect(data.pending.items.length).toBe(1)
  expect(data.pending.total).toBe(20)
  expect(data.pending.page).toBe(2)
  // The other sections came back on their own first pages.
  expect(data.approved.page).toBe(1)
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
  const responseBody = { detail: 'You already have an open request on this listing.' }
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
    detail: 'This request is not approved, so it cannot be cancelled.',
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
    items: [
      {
        listing_id: 'l1',
        listing_title: 'Lemons',
        remaining_quantity: 4,
        requests: [],
      },
    ],
    total: 1,
    page: 1,
    page_size: 12,
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
  // With no listing id, the query string is just the page window.
  expect(requestUrl).toBe('/api/request-queues/all?page=1&page_size=12')
  expect(requestOptions.method).toBe('GET')
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
  expect(requestOptions.signal).toBeTruthy()
})

test('all requests appends the listing id as a query param when given one', async () => {
  let requestUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    requestUrl = String(url)
    return makeFakeResponse(true, 200, JSON.stringify({ items: [], total: 0, page: 1, page_size: 12 }))
  })

  await sendGetAllRequestsRequest('member-123', 'listing-abc')

  expect(requestUrl).toBe('/api/request-queues/all?listing=listing-abc&page=1&page_size=12')
})

// --- US-33: all requests pages the listings, filter and all ---

test('all requests sends the page window it was given', async () => {
  let requestUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    requestUrl = String(url)
    return makeFakeResponse(true, 200, JSON.stringify({ items: [], total: 0, page: 3, page_size: 12 }))
  })

  await sendGetAllRequestsRequest('member-123', '', 3, 12)

  expect(requestUrl).toBe('/api/request-queues/all?page=3&page_size=12')
})

test('all requests keeps the listing filter alongside the page window', async () => {
  let requestUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    requestUrl = String(url)
    return makeFakeResponse(true, 200, JSON.stringify({ items: [], total: 0, page: 2, page_size: 12 }))
  })

  await sendGetAllRequestsRequest('member-123', 'listing-abc', 2, 12)

  expect(requestUrl).toContain('listing=listing-abc')
  expect(requestUrl).toContain('page=2')
  expect(requestUrl).toContain('page_size=12')
})

test('all requests hands back the paged envelope of listing groups', async () => {
  const responseBody = {
    items: [{ listing_id: 'l1', listing_title: 'Lemons', remaining_quantity: 4, requests: [] }],
    total: 25,
    page: 2,
    page_size: 12,
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, JSON.stringify(responseBody))
  })

  const result = await sendGetAllRequestsRequest('member-123', '', 2, 12)

  const data = result.data as { items: unknown[]; total: number; page: number }
  expect(data.items.length).toBe(1)
  // total counts the caller's listings, which is what pages here.
  expect(data.total).toBe(25)
  expect(data.page).toBe(2)
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

// --- US-24: sendGetExchangeHistoryRequest returns the caller's exchange history ---

test('gets the exchange history at /api/exchange-history with the member id header', async () => {
  const responseBody = {
    requested: [],
    approved: [
      {
        id: 'c1',
        listing_id: 'l1',
        listing_title: 'Lemons',
        side: 'recipient',
        other_party_name: 'Dave Diaz',
        requested_quantity: 2,
        approved_quantity: 2,
        status: 'approved',
        requested_at: '2026-07-01T09:00:00.000Z',
        approved_at: '2026-07-02T09:00:00.000Z',
        picked_up_at: null,
        completed_at: null,
        cancelled_at: null,
        denied_at: null,
      },
    ],
    picked_up: [],
    completed: [],
    cancelled: [],
    denied: [],
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

  const result = await sendGetExchangeHistoryRequest('member-123')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
  expect(requestUrl).toBe('/api/exchange-history')
  expect(requestOptions.method).toBe('GET')
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
  expect(requestOptions.signal).toBeTruthy()
})

test('exchange history keeps a non-JSON body as plain text', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 502, 'Bad gateway')
  })

  const result = await sendGetExchangeHistoryRequest('member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(502)
  expect(result.data).toBe('Bad gateway')
})

test('exchange history maps an HTTP error response into the result object', async () => {
  const responseBody = {
    detail: 'Your account is suspended, so you cannot view your exchange history.',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 403, JSON.stringify(responseBody))
  })

  const result = await sendGetExchangeHistoryRequest('member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(403)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
})

test('exchange history returns a timeout message when the request times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendGetExchangeHistoryRequest('member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + requestQueueTimeoutMilliseconds + ' ms.',
  )
})

test('exchange history reports other transport failures with the error text', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('network down')
  })

  const result = await sendGetExchangeHistoryRequest('member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toContain('Request failed:')
  expect(result.errorMessage).toContain('network down')
})
