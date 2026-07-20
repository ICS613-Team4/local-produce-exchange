import { afterEach, expect, test, vi } from 'vitest'

import {
  reviewTimeoutMilliseconds,
  sendCreateReviewRequest,
  sendDeleteReviewRequest,
  sendEditReviewRequest,
  sendGetMemberReviewsRequest,
  sendGetReviewContextRequest,
  sendGetReviewsForClaimRequest,
} from './reviewService'
import type { ReviewContext } from './reviewService'

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

const disabledMessage =
  'An administrator disabled your review for this exchange because it broke ' +
  'the community rules. You cannot edit it or leave a new review for this exchange.'

// The delete refusal opens with the same reason and closes with what was
// refused, the way the backend words it.
const disabledDeleteMessage =
  'An administrator disabled your review for this exchange because it broke ' +
  'the community rules. You cannot delete it.'

// ── sendCreateReviewRequest ──────────────────────────────────────────────────

test('create POSTs the rating and body with the member header', async () => {
  const responseBody = {
    id: 'review-1',
    claim_id: 'claim-1',
    rating: 4,
    body: 'Great to work with.',
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

  const result = await sendCreateReviewRequest('member-1', 'claim-1', 4, 'Great to work with.')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(201)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
  expect(requestUrl).toBe('/api/claims/claim-1/reviews')
  expect(requestOptions.method).toBe('POST')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-1')
  expect(JSON.stringify(requestOptions.headers)).toContain('application/json')
  expect(requestOptions.body).toBe('{"rating":4,"body":"Great to work with."}')
  expect(requestOptions.signal).toBeTruthy()
})

test('create surfaces a non-OK response body', async () => {
  const errorBody = { detail: 'You have already reviewed this exchange.' }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 409, JSON.stringify(errorBody))
  })

  const result = await sendCreateReviewRequest('member-1', 'claim-1', 4, '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(409)
  expect(JSON.stringify(result.data)).toContain('already reviewed')
  expect(result.errorMessage).toBe('')
})

test('create keeps a plain text response body', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 502, 'Bad Gateway')
  })

  const result = await sendCreateReviewRequest('member-1', 'claim-1', 4, '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(502)
  expect(result.data).toBe('Bad Gateway')
})

test('create returns a request failure message when fetch rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  const result = await sendCreateReviewRequest('member-1', 'claim-1', 4, '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe('Request failed: TypeError: Failed to fetch')
})

test('create returns a timeout message when fetch times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendCreateReviewRequest('member-1', 'claim-1', 4, '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + reviewTimeoutMilliseconds + ' ms.',
  )
})

// ── sendEditReviewRequest ────────────────────────────────────────────────────

test('edit PATCHes the review URL with the rating and body', async () => {
  const responseBody = {
    id: 'review-1',
    claim_id: 'claim-1',
    rating: 5,
    body: 'Even better.',
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

  const result = await sendEditReviewRequest('member-1', 'claim-1', 5, 'Even better.')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(requestUrl).toBe('/api/claims/claim-1/review')
  expect(requestOptions.method).toBe('PATCH')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-1')
  expect(JSON.stringify(requestOptions.headers)).toContain('application/json')
  expect(requestOptions.body).toBe('{"rating":5,"body":"Even better."}')
})

test('edit surfaces the disabled 403 message body', async () => {
  const errorBody = { detail: disabledMessage }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 403, JSON.stringify(errorBody))
  })

  const result = await sendEditReviewRequest('member-1', 'claim-1', 2, 'sneaky edit')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(403)
  expect(JSON.stringify(result.data)).toContain('disabled')
  expect(JSON.stringify(result.data)).toContain('administrator')
})

test('edit keeps a plain text response body', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 502, 'Bad Gateway')
  })

  const result = await sendEditReviewRequest('member-1', 'claim-1', 3, '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(502)
  expect(result.data).toBe('Bad Gateway')
})

test('edit returns a timeout message when fetch times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendEditReviewRequest('member-1', 'claim-1', 3, '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + reviewTimeoutMilliseconds + ' ms.',
  )
})

test('edit returns a request failure message when fetch rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  const result = await sendEditReviewRequest('member-1', 'claim-1', 3, '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe('Request failed: TypeError: Failed to fetch')
})

// ── sendGetReviewContextRequest ──────────────────────────────────────────────

test('get context GETs the review URL and parses the body', async () => {
  const contextBody: ReviewContext = {
    claim_id: 'claim-1',
    listing_id: 'listing-1',
    listing_title: 'Fresh Manoa Lettuce',
    role: 'requestor',
    other_party_id: 'member-2',
    other_party_name: 'Bob Baker',
    completed_at: '2026-07-04T09:00:00.000Z',
    already_reviewed: true,
    existing_review: {
      id: 'review-1',
      claim_id: 'claim-1',
      reviewer_id: 'member-1',
      reviewee_id: 'member-2',
      reviewee_role: 'listing_owner',
      rating: 3,
      body: 'ok',
      created_at: '2026-07-05T09:00:00.000Z',
      updated_at: '2026-07-05T09:00:00.000Z',
      is_disabled: true,
    },
    can_edit: false,
  }
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) {
      requestOptions = options
    }
    return makeFakeResponse(true, 200, JSON.stringify(contextBody))
  })

  const result = await sendGetReviewContextRequest('member-1', 'claim-1')

  expect(result.ok).toBe(true)
  expect(requestUrl).toBe('/api/claims/claim-1/review')
  expect(requestOptions.method).toBe('GET')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-1')
  const parsed = result.data as ReviewContext
  expect(parsed.can_edit).toBe(false)
  expect(parsed.existing_review?.is_disabled).toBe(true)
  expect(parsed.listing_title).toBe('Fresh Manoa Lettuce')
})

test('get context returns a timeout message when fetch times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendGetReviewContextRequest('member-1', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + reviewTimeoutMilliseconds + ' ms.',
  )
})

test('get context keeps a plain text response body', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 502, 'Bad Gateway')
  })

  const result = await sendGetReviewContextRequest('member-1', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(502)
  expect(result.data).toBe('Bad Gateway')
})

test('get context returns a request failure message when fetch rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  const result = await sendGetReviewContextRequest('member-1', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe('Request failed: TypeError: Failed to fetch')
})

// ── sendGetReviewsForClaimRequest (US-21) ────────────────────────────────────

test('get reviews for a claim GETs the reviews path with the member header', async () => {
  const responseBody = {
    claim_id: 'claim-1',
    listing_title: "Bob's Tomatoes",
    reviews: [
      {
        id: 'review-1',
        reviewer_id: 'member-2',
        reviewer_name: 'Carol Chen',
        reviewee_id: 'member-1',
        reviewee_name: 'Bob Baker',
        reviewee_role: 'listing_owner',
        rating: 4,
        body: 'Great to work with.',
        created_at: '2026-07-01T10:00:00Z',
        updated_at: '2026-07-01T10:00:00Z',
        about_viewer: true,
        by_viewer: false,
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

  const result = await sendGetReviewsForClaimRequest('member-1', 'claim-1')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
  expect(requestUrl).toBe('/api/claims/claim-1/reviews')
  expect(requestOptions.method).toBe('GET')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-1')
  expect(requestOptions.body).toBeUndefined()
  expect(requestOptions.signal).toBeTruthy()
})

test('get reviews for a claim surfaces a non-OK response body', async () => {
  const errorBody = { detail: 'You can only review an exchange you took part in.' }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 403, JSON.stringify(errorBody))
  })

  const result = await sendGetReviewsForClaimRequest('member-9', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(403)
  expect(JSON.stringify(result.data)).toContain('took part in')
})

test('get reviews for a claim keeps a plain text response body', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 502, 'Bad Gateway')
  })

  const result = await sendGetReviewsForClaimRequest('member-1', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(502)
  expect(result.data).toBe('Bad Gateway')
})

test('get reviews for a claim returns a timeout message when fetch times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendGetReviewsForClaimRequest('member-1', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + reviewTimeoutMilliseconds + ' ms.',
  )
})

test('get reviews for a claim returns a request failure message when fetch rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  const result = await sendGetReviewsForClaimRequest('member-1', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe('Request failed: TypeError: Failed to fetch')
})

// ── sendGetMemberReviewsRequest (US-21) ──────────────────────────────────────

test('get member reviews puts the viewed member in the path and the caller in the header', async () => {
  const responseBody = {
    member_id: 'viewed-member',
    member_name: 'Bob Baker',
    role: 'listing_owner',
    average: 4.0,
    count: 1,
    reviews: [],
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

  // The two ids are deliberately different, so a swapped argument fails here.
  const result = await sendGetMemberReviewsRequest(
    'acting-member',
    'viewed-member',
    'listing_owner',
  )

  expect(result.ok).toBe(true)
  expect(requestUrl).toBe('/api/members/viewed-member/reviews?role=listing_owner')
  expect(requestOptions.method).toBe('GET')
  expect(JSON.stringify(requestOptions.headers)).toContain('acting-member')
  expect(JSON.stringify(requestOptions.headers)).not.toContain('viewed-member')
  expect(requestOptions.signal).toBeTruthy()
})

test('get member reviews passes the requestor role through unchanged', async () => {
  let requestUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    requestUrl = String(url)
    return makeFakeResponse(true, 200, JSON.stringify({ role: 'requestor' }))
  })

  await sendGetMemberReviewsRequest('acting-member', 'viewed-member', 'requestor')

  expect(requestUrl).toBe('/api/members/viewed-member/reviews?role=requestor')
})

test('get member reviews surfaces a not-found response body', async () => {
  const errorBody = { detail: 'Member not found.' }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 404, JSON.stringify(errorBody))
  })

  const result = await sendGetMemberReviewsRequest('acting-member', 'nobody', 'listing_owner')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(404)
  expect(JSON.stringify(result.data)).toContain('Member not found.')
})

test('get member reviews keeps a plain text response body', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 502, 'Bad Gateway')
  })

  const result = await sendGetMemberReviewsRequest('acting-member', 'viewed-member', 'requestor')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(502)
  expect(result.data).toBe('Bad Gateway')
})

test('get member reviews returns a timeout message when fetch times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendGetMemberReviewsRequest('acting-member', 'viewed-member', 'requestor')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + reviewTimeoutMilliseconds + ' ms.',
  )
})

test('get member reviews returns a request failure message when fetch rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  const result = await sendGetMemberReviewsRequest('acting-member', 'viewed-member', 'requestor')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe('Request failed: TypeError: Failed to fetch')
})

// ── sendDeleteReviewRequest ──────────────────────────────────────────────────

test('delete DELETEs the review URL with the member header and no body', async () => {
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) {
      requestOptions = options
    }
    return makeFakeResponse(true, 204, '')
  })

  const result = await sendDeleteReviewRequest('member-1', 'claim-1')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(204)
  expect(result.data).toBe('')
  expect(result.errorMessage).toBe('')
  // No review id in the URL: the backend can only reach the caller's own row.
  expect(requestUrl).toBe('/api/claims/claim-1/review')
  expect(requestOptions.method).toBe('DELETE')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-1')
  expect(requestOptions.body).toBe(undefined)
  expect(requestOptions.signal).toBeTruthy()
})

test('delete reports a repeat delete as another success', async () => {
  // The idempotent case: the review is already gone and the backend answers
  // 204 again, so the caller sees a success both times.
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 204, ''))

  const first = await sendDeleteReviewRequest('member-1', 'claim-1')
  const second = await sendDeleteReviewRequest('member-1', 'claim-1')

  expect(first.ok).toBe(true)
  expect(second.ok).toBe(true)
  expect(second.status).toBe(204)
})

test('delete surfaces the disabled 403 message body', async () => {
  const errorBody = { detail: disabledDeleteMessage }
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 403, JSON.stringify(errorBody)))

  const result = await sendDeleteReviewRequest('member-1', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(403)
  expect(JSON.stringify(result.data)).toContain('An administrator disabled your review')
})

test('delete keeps a plain text response body', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 502, 'Bad Gateway'))

  const result = await sendDeleteReviewRequest('member-1', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(502)
  expect(result.data).toBe('Bad Gateway')
})

test('delete returns a timeout message when fetch times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendDeleteReviewRequest('member-1', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + reviewTimeoutMilliseconds + ' ms.',
  )
})

test('delete returns a request failure message when fetch rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  const result = await sendDeleteReviewRequest('member-1', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe('Request failed: TypeError: Failed to fetch')
})
