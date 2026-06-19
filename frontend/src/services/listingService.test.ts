import { afterEach, expect, test, vi } from 'vitest'

import { listingTimeoutMilliseconds, sendCreateListingRequest } from './listingService'

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

// A plain set of valid listing fields the page would build.
function makeFields() {
  const fields = {
    title: 'Fresh Tomatoes',
    description: 'Ripe red tomatoes.',
    category: 'Vegetables',
    total_quantity: 5,
    dietary_tags: ['vegan'],
    allergen_tags: [],
    pickup_start: '2026-07-01T09:00:00.000Z',
    pickup_end: '2026-07-01T11:00:00.000Z',
  }
  return fields
}

test('posts the listing JSON with the member id header and parses a JSON response', async () => {
  const responseBody = {
    id: 'listing-row-id',
    owner_id: 'member-123',
    status: 'active',
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

  const result = await sendCreateListingRequest('member-123', makeFields())

  expect(result.ok).toBe(true)
  expect(result.status).toBe(201)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
  expect(requestUrl).toBe('/api/listings')
  expect(requestOptions.method).toBe('POST')
  // The member id rides in the X-Member-Id header, not a request body field.
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
  expect(requestOptions.signal).toBeTruthy()

  // The body carries the listing fields under the names the backend expects.
  const sentBody = JSON.parse(String(requestOptions.body))
  expect(sentBody.title).toBe('Fresh Tomatoes')
  expect(sentBody.total_quantity).toBe(5)
  expect(sentBody.dietary_tags).toEqual(['vegan'])
})

test('maps an HTTP error response into the result object', async () => {
  const responseBody = {
    detail: 'Quantity available must be greater than zero.',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 422, JSON.stringify(responseBody))
  })

  const result = await sendCreateListingRequest('member-123', makeFields())

  expect(result.ok).toBe(false)
  expect(result.status).toBe(422)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
})

test('keeps a plain text response body', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 502, 'Bad Gateway')
  })

  const result = await sendCreateListingRequest('member-123', makeFields())

  expect(result.ok).toBe(false)
  expect(result.status).toBe(502)
  expect(result.data).toBe('Bad Gateway')
  expect(result.errorMessage).toBe('')
})

test('keeps an empty response body as an empty string', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 204, '')
  })

  const result = await sendCreateListingRequest('member-123', makeFields())

  expect(result.ok).toBe(false)
  expect(result.status).toBe(204)
  expect(result.data).toBe('')
  expect(result.errorMessage).toBe('')
})

test('returns a timeout message when fetch times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendCreateListingRequest('member-123', makeFields())

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + listingTimeoutMilliseconds + ' ms.',
  )
})

test('returns a request failure message when fetch rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  const result = await sendCreateListingRequest('member-123', makeFields())

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe('Request failed: TypeError: Failed to fetch')
})
