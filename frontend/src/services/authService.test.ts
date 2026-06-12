import { afterEach, expect, test, vi } from 'vitest'

import { authTimeoutMilliseconds, sendRegisterRequest } from './authService'

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

test('posts the registration JSON and parses a JSON response', async () => {
  const responseBody = {
    id: 'a4c135d8-0000-0000-0000-000000000000',
    name: 'New Person',
    email: 'new@example.com',
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

  const result = await sendRegisterRequest('New Person', 'new@example.com', 'password123', 'tok-1')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
  expect(requestUrl).toBe('/api/auth/register')
  expect(requestOptions.method).toBe('POST')
  expect(JSON.stringify(requestOptions.headers)).toContain('application/json')
  expect(requestOptions.signal).toBeTruthy()

  // The body carries all four values under the names the backend expects.
  const sentBody = JSON.parse(String(requestOptions.body))
  expect(sentBody.name).toBe('New Person')
  expect(sentBody.email).toBe('new@example.com')
  expect(sentBody.password).toBe('password123')
  expect(sentBody.invite_token).toBe('tok-1')
})

test('maps an HTTP error response into the result object', async () => {
  const responseBody = {
    detail: 'Invalid or already-used invite token.',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 400, JSON.stringify(responseBody))
  })

  const result = await sendRegisterRequest('New Person', 'new@example.com', 'password123', 'bad')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(400)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
})

test('keeps a plain text response body', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 502, 'Bad Gateway')
  })

  const result = await sendRegisterRequest('New Person', 'new@example.com', 'password123', 'tok')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(502)
  expect(result.data).toBe('Bad Gateway')
  expect(result.errorMessage).toBe('')
})

test('keeps an empty response body as an empty string', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 204, '')
  })

  const result = await sendRegisterRequest('New Person', 'new@example.com', 'password123', 'tok')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(204)
  expect(result.data).toBe('')
  expect(result.errorMessage).toBe('')
})

test('returns a timeout message when fetch times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendRegisterRequest('New Person', 'new@example.com', 'password123', 'tok')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + authTimeoutMilliseconds + ' ms.',
  )
})

test('returns a request failure message when fetch rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  const result = await sendRegisterRequest('New Person', 'new@example.com', 'password123', 'tok')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe('Request failed: TypeError: Failed to fetch')
})
