import { afterEach, expect, test, vi } from 'vitest'

import { inviteTimeoutMilliseconds, sendCreateInviteRequest } from './inviteService'

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

test('posts the member id and returns the token on success', async () => {
  const responseBody = {
    id: 'token-row-id',
    token: 'fresh-token-abc',
    status: 'pending',
    expires_at: null,
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

  const result = await sendCreateInviteRequest('member-123')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(201)
  const data = result.data as { token: string }
  expect(data.token).toBe('fresh-token-abc')
  expect(result.errorMessage).toBe('')
  expect(requestUrl).toBe('/api/invites')
  expect(requestOptions.method).toBe('POST')
  // The member id now rides in the X-Member-Id header, not the request body.
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
  expect(requestOptions.signal).toBeTruthy()
})

test('surfaces a non-OK status with the response body', async () => {
  const responseBody = {
    detail: 'Your account is suspended, so you cannot create invites.',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 403, JSON.stringify(responseBody))
  })

  const result = await sendCreateInviteRequest('member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(403)
  const data = result.data as { detail: string }
  expect(data.detail).toContain('suspended')
  expect(result.errorMessage).toBe('')
})

test('keeps a plain text response body', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 502, 'Bad Gateway')
  })

  const result = await sendCreateInviteRequest('member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(502)
  expect(result.data).toBe('Bad Gateway')
  expect(result.errorMessage).toBe('')
})

test('returns a timeout message when fetch times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendCreateInviteRequest('member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + inviteTimeoutMilliseconds + ' ms.',
  )
})

test('returns a request failure message when fetch rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  const result = await sendCreateInviteRequest('member-123')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe('Request failed: TypeError: Failed to fetch')
})
