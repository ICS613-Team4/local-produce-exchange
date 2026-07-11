import { afterEach, expect, test, vi } from 'vitest'

import {
  listingPhotoUploadTimeoutMilliseconds,
  listingTimeoutMilliseconds,
  sendBrowseListingsRequest,
  sendCreateListingRequest,
  sendDeactivateListingRequest,
  sendDeleteListingPhotoRequest,
  sendGetListingRequest,
  sendGetMyListingsRequest,
  sendUpdateListingRequest,
  sendUploadListingPhotoRequest,
} from './listingService'

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

// --- US-07: sendGetListingRequest fetches one listing's details ---

test('gets the listing by id with the member id header and parses a JSON response', async () => {
  const responseBody = {
    id: 'listing-row-id',
    owner_id: 'member-123',
    title: 'Backyard Lemons',
    status: 'active',
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

  const result = await sendGetListingRequest('listing-row-id', 'member-123')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
  expect(requestUrl).toBe('/api/listings/listing-row-id')
  expect(requestOptions.method).toBe('GET')
  // The member id rides in the X-Member-Id header.
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
  // The timeout signal must be present so the function can't silently drop it.
  expect(requestOptions.signal).toBeTruthy()
})

test('maps a 404 not-found response into the result object', async () => {
  const responseBody = {
    detail: 'This listing is unavailable.',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 404, JSON.stringify(responseBody))
  })

  const result = await sendGetListingRequest('missing-id', 'member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(404)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
})

test('keeps a plain text body on a get request', async () => {
  // A proxy or server problem can return non-JSON text; the function keeps the
  // status and the raw body instead of throwing the parse error away.
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 502, 'Bad Gateway')
  })

  const result = await sendGetListingRequest('listing-row-id', 'member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(502)
  expect(result.data).toBe('Bad Gateway')
  expect(result.errorMessage).toBe('')
})

test('returns a timeout message when the get request times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendGetListingRequest('listing-row-id', 'member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toContain('Timeout')
})

test('returns a request failure message when the get request rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  const result = await sendGetListingRequest('listing-row-id', 'member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).not.toBe('')
})

// --- US-16: sendUpdateListingRequest edits one listing ---

test('puts the listing JSON to the listing URL with the member id header', async () => {
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
    return makeFakeResponse(true, 200, JSON.stringify(responseBody))
  })

  const result = await sendUpdateListingRequest('listing-row-id', 'member-123', makeFields())

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
  expect(requestUrl).toBe('/api/listings/listing-row-id')
  expect(requestOptions.method).toBe('PUT')
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
  expect(requestOptions.signal).toBeTruthy()

  const sentBody = JSON.parse(String(requestOptions.body))
  expect(sentBody.title).toBe('Fresh Tomatoes')
  expect(sentBody.total_quantity).toBe(5)
  expect(sentBody.dietary_tags).toEqual(['vegan'])
})

test('maps an update HTTP error response into the result object', async () => {
  const responseBody = {
    detail: 'You can only edit your own listing.',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 403, JSON.stringify(responseBody))
  })

  const result = await sendUpdateListingRequest('listing-row-id', 'member-123', makeFields())

  expect(result.ok).toBe(false)
  expect(result.status).toBe(403)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
})

test('returns a timeout message when the update request times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendUpdateListingRequest('listing-row-id', 'member-123', makeFields())

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + listingTimeoutMilliseconds + ' ms.',
  )
})

// --- US-17: sendDeactivateListingRequest deactivates one listing ---

test('posts to the deactivate URL with the member id header and no body', async () => {
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) {
      requestOptions = options
    }
    // The endpoint answers 204 with an empty body on success.
    return makeFakeResponse(true, 204, '')
  })

  const result = await sendDeactivateListingRequest('listing-row-id', 'member-123')

  // A 204 empty body parses to ok true with an empty-string data.
  expect(result.ok).toBe(true)
  expect(result.status).toBe(204)
  expect(result.data).toBe('')
  expect(result.errorMessage).toBe('')
  expect(requestUrl).toBe('/api/listings/listing-row-id/deactivate')
  expect(requestOptions.method).toBe('POST')
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
  expect(requestOptions.signal).toBeTruthy()
  // The deactivate call sends no request body.
  expect(requestOptions.body).toBeUndefined()
})

test('maps a deactivate HTTP error response into the result object', async () => {
  const responseBody = {
    detail: 'You can only deactivate your own listing.',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 403, JSON.stringify(responseBody))
  })

  const result = await sendDeactivateListingRequest('listing-row-id', 'member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(403)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
})

test('keeps a plain text body on a deactivate request', async () => {
  // A proxy or server problem can return non-JSON text; the function keeps the
  // status and the raw body instead of throwing the parse error away.
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 502, 'Bad Gateway')
  })

  const result = await sendDeactivateListingRequest('listing-row-id', 'member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(502)
  expect(result.data).toBe('Bad Gateway')
  expect(result.errorMessage).toBe('')
})

test('returns a timeout message when the deactivate request times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendDeactivateListingRequest('listing-row-id', 'member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + listingTimeoutMilliseconds + ' ms.',
  )
})

test('returns a request failure message when the deactivate request rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  const result = await sendDeactivateListingRequest('listing-row-id', 'member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe('Request failed: TypeError: Failed to fetch')
})

// --- US-06: sendBrowseListingsRequest lists active listings ---

test('browses with no filters, calling the plain listings URL with the member header', async () => {
  const responseBody = [{ id: 'l1', title: 'Lemons', status: 'active' }]
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) {
      requestOptions = options
    }
    return makeFakeResponse(true, 200, JSON.stringify(responseBody))
  })

  const result = await sendBrowseListingsRequest('member-123', {})

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
  // With no filters, the URL carries no query string at all.
  expect(requestUrl).toBe('/api/listings')
  expect(requestOptions.method).toBe('GET')
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
  // The timeout signal must be present so the function can't silently drop it.
  expect(requestOptions.signal).toBeTruthy()
})

test('browses with filters, building search text, category, and repeated tag params', async () => {
  let requestUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    requestUrl = String(url)
    return makeFakeResponse(true, 200, JSON.stringify([]))
  })

  const filters = {
    q: 'lemon',
    category: 'Fruit',
    dietary_tags: ['vegan', 'gluten-free'],
    allergen_tags: ['contains nuts'],
    limit: 25,
  }
  const result = await sendBrowseListingsRequest('member-123', filters)

  expect(result.ok).toBe(true)
  // The query string carries the search text, the category, each tag as its own
  // repeated param, and the limit. A space inside a tag is encoded as a plus.
  expect(requestUrl).toContain('/api/listings?')
  expect(requestUrl).toContain('q=lemon')
  expect(requestUrl).toContain('category=Fruit')
  expect(requestUrl).toContain('dietary_tags=vegan')
  expect(requestUrl).toContain('dietary_tags=gluten-free')
  expect(requestUrl).toContain('allergen_tags=contains+nuts')
  expect(requestUrl).toContain('limit=25')
})

test('browse omits empty filter fields from the query string', async () => {
  let requestUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    requestUrl = String(url)
    return makeFakeResponse(true, 200, JSON.stringify([]))
  })

  // Empty search text, empty category, and empty tag lists must not appear.
  const filters = {
    q: '',
    category: '',
    dietary_tags: [],
    allergen_tags: [],
  }
  await sendBrowseListingsRequest('member-123', filters)

  expect(requestUrl).toBe('/api/listings')
})

test('browse maps an HTTP error response into the result object', async () => {
  const responseBody = { detail: 'Your account is suspended, so you cannot view listings.' }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 403, JSON.stringify(responseBody))
  })

  const result = await sendBrowseListingsRequest('member-123', {})

  expect(result.ok).toBe(false)
  expect(result.status).toBe(403)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
})

test('browse returns a timeout message when the request times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendBrowseListingsRequest('member-123', {})

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + listingTimeoutMilliseconds + ' ms.',
  )
})

test('browse returns a request failure message when fetch rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  const result = await sendBrowseListingsRequest('member-123', {})

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe('Request failed: TypeError: Failed to fetch')
})

test('browse keeps a plain text response body', async () => {
  // A proxy or server problem can return non-JSON text; the function keeps the
  // status and the raw body instead of throwing the parse error away.
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 502, 'Bad Gateway')
  })

  const result = await sendBrowseListingsRequest('member-123', {})

  expect(result.ok).toBe(false)
  expect(result.status).toBe(502)
  expect(result.data).toBe('Bad Gateway')
  expect(result.errorMessage).toBe('')
})

// --- US-24: sendGetMyListingsRequest lists the caller's own listings ---

test('gets my listings at /api/my-listings with the member id header', async () => {
  const responseBody = [
    { id: 'l1', title: 'Mine', status: 'active', deactivated_by: null },
  ]
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) {
      requestOptions = options
    }
    return makeFakeResponse(true, 200, JSON.stringify(responseBody))
  })

  const result = await sendGetMyListingsRequest('member-123')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
  // No filters, so the URL is the plain my-listings path.
  expect(requestUrl).toBe('/api/my-listings')
  expect(requestOptions.method).toBe('GET')
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
  expect(requestOptions.signal).toBeTruthy()
})

test('my listings maps an HTTP error response into the result object', async () => {
  const responseBody = { detail: 'Your account is suspended, so you cannot view listings.' }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 403, JSON.stringify(responseBody))
  })

  const result = await sendGetMyListingsRequest('member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(403)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
})

test('my listings returns a timeout message when the request times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendGetMyListingsRequest('member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + listingTimeoutMilliseconds + ' ms.',
  )
})

test('my listings returns a request failure message when fetch rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  const result = await sendGetMyListingsRequest('member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe('Request failed: TypeError: Failed to fetch')
})

// --- US-30: listing photo upload and removal ---

test('uploads a photo as form data without setting the content type header', async () => {
  const responseBody = {
    id: 'photo-row-id',
    content_type: 'image/png',
    position: 0,
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
  const file = new File(['image bytes'], 'lettuce.png', { type: 'image/png' })

  const result = await sendUploadListingPhotoRequest(
    'listing-row-id',
    'member-123',
    file,
  )

  expect(result.ok).toBe(true)
  expect(result.status).toBe(201)
  expect(result.data).toEqual(responseBody)
  expect(requestUrl).toBe('/api/listings/listing-row-id/photos')
  expect(requestOptions.method).toBe('POST')
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).not.toContain('Content-Type')
  expect(requestOptions.body).toBeInstanceOf(FormData)
  const sentForm = requestOptions.body as FormData
  expect(sentForm.get('file')).toBe(file)
  expect(requestOptions.signal).toBeTruthy()
})

test('returns the backend error when a photo upload is rejected', async () => {
  const responseBody = { detail: 'That file type is not allowed.' }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 422, JSON.stringify(responseBody))
  })
  const file = new File(['text'], 'notes.txt', { type: 'text/plain' })

  const result = await sendUploadListingPhotoRequest('listing-id', 'member-id', file)

  expect(result.ok).toBe(false)
  expect(result.status).toBe(422)
  expect(result.data).toEqual(responseBody)
})

test('keeps a plain text photo upload error body', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 502, 'Bad Gateway')
  })
  const file = new File(['image bytes'], 'lettuce.png', { type: 'image/png' })

  const result = await sendUploadListingPhotoRequest('listing-id', 'member-id', file)

  expect(result.ok).toBe(false)
  expect(result.status).toBe(502)
  expect(result.data).toBe('Bad Gateway')
})

test('returns the longer timeout message when a photo upload times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })
  const file = new File(['image bytes'], 'lettuce.png', { type: 'image/png' })

  const result = await sendUploadListingPhotoRequest('listing-id', 'member-id', file)

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' +
      listingPhotoUploadTimeoutMilliseconds +
      ' ms.',
  )
})

test('returns a request failure when a photo upload fetch rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })
  const file = new File(['image bytes'], 'lettuce.png', { type: 'image/png' })

  const result = await sendUploadListingPhotoRequest('listing-id', 'member-id', file)

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe('Request failed: TypeError: Failed to fetch')
})

test('deletes a photo with the member id header', async () => {
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) {
      requestOptions = options
    }
    return makeFakeResponse(true, 204, '')
  })

  const result = await sendDeleteListingPhotoRequest(
    'listing-row-id',
    'member-123',
    'photo-row-id',
  )

  expect(result.ok).toBe(true)
  expect(result.status).toBe(204)
  expect(result.data).toBe('')
  expect(requestUrl).toBe('/api/listings/listing-row-id/photos/photo-row-id')
  expect(requestOptions.method).toBe('DELETE')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
  expect(requestOptions.signal).toBeTruthy()
})

test('returns the backend error when a photo removal is denied', async () => {
  const responseBody = { detail: 'You can only change photos on your own listing.' }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 403, JSON.stringify(responseBody))
  })

  const result = await sendDeleteListingPhotoRequest('listing-id', 'member-id', 'photo-id')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(403)
  expect(result.data).toEqual(responseBody)
})

test('keeps a plain text photo removal error body', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 502, 'Bad Gateway')
  })

  const result = await sendDeleteListingPhotoRequest('listing-id', 'member-id', 'photo-id')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(502)
  expect(result.data).toBe('Bad Gateway')
})

test('returns a timeout message when a photo removal times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendDeleteListingPhotoRequest('listing-id', 'member-id', 'photo-id')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + listingTimeoutMilliseconds + ' ms.',
  )
})

test('returns a request failure when a photo removal fetch rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  const result = await sendDeleteListingPhotoRequest('listing-id', 'member-id', 'photo-id')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe('Request failed: TypeError: Failed to fetch')
})
