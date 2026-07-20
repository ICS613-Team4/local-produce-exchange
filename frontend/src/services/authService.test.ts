// @vitest-environment jsdom
//
// jsdom, not the default environment: clearStoredLogin reads window,
// localStorage, and dispatches a DOM event. The fetch-based tests below stub
// fetch themselves, so they run the same either way.

import { afterEach, expect, test, vi } from 'vitest'

import {
  authStateChangedEventName,
  authTimeoutMilliseconds,
  clearStoredLogin,
  sendLoginRequest,
  sendLogoutRequest,
  sendRegisterRequest,
} from './authService'

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

// --- sendRegisterRequest tests ---

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

// --- sendLoginRequest tests ---

test('posts the login JSON and parses a JSON response', async () => {
  const responseBody = {
    id: 'a4c135d8-0000-0000-0000-000000000000',
    name: 'Alice Admin',
    email: 'alice@example.com',
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

  const result = await sendLoginRequest('alice@example.com', 'password')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
  expect(requestUrl).toBe('/api/auth/login')
  expect(requestOptions.method).toBe('POST')
  expect(JSON.stringify(requestOptions.headers)).toContain('application/json')
  expect(requestOptions.signal).toBeTruthy()

  const sentBody = JSON.parse(String(requestOptions.body))
  expect(sentBody.email).toBe('alice@example.com')
  expect(sentBody.password).toBe('password')
})

test('maps a login 401 error into the result object', async () => {
  const responseBody = {
    detail: 'Invalid email or password.',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 401, JSON.stringify(responseBody))
  })

  const result = await sendLoginRequest('alice@example.com', 'wrong')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(401)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
})

test('maps a login 403 suspension error into the result object', async () => {
  const responseBody = {
    detail: 'Your account is suspended.',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 403, JSON.stringify(responseBody))
  })

  const result = await sendLoginRequest('suspended@example.com', 'password')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(403)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
})

test('returns a timeout message when login fetch times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendLoginRequest('alice@example.com', 'password')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + authTimeoutMilliseconds + ' ms.',
  )
})

// --- sendLogoutRequest tests ---

test('posts to the logout endpoint and parses the response', async () => {
  const responseBody = {
    detail: 'Logged out.',
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

  const result = await sendLogoutRequest()

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
  expect(requestUrl).toBe('/api/auth/logout')
  expect(requestOptions.method).toBe('POST')
})

test('returns a timeout message when logout fetch times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendLogoutRequest()

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + authTimeoutMilliseconds + ' ms.',
  )
})


// ── clearStoredLogin ─────────────────────────────────────────────────────────

test('clearStoredLogin removes the three stored keys and fires the event once', () => {
  window.localStorage.setItem('memberId', 'member-1')
  window.localStorage.setItem('memberName', 'Bob Baker')
  window.localStorage.setItem('memberEmail', 'bob@example.com')

  let eventCount = 0
  function handleAuthEvent() {
    eventCount = eventCount + 1
  }
  window.addEventListener(authStateChangedEventName, handleAuthEvent)

  clearStoredLogin()

  expect(window.localStorage.getItem('memberId')).toBeNull()
  expect(window.localStorage.getItem('memberName')).toBeNull()
  expect(window.localStorage.getItem('memberEmail')).toBeNull()
  expect(eventCount).toBe(1)

  window.removeEventListener(authStateChangedEventName, handleAuthEvent)
})

test('clearStoredLogin still fires the event when nothing was stored', () => {
  window.localStorage.clear()

  let eventCount = 0
  function handleAuthEvent() {
    eventCount = eventCount + 1
  }
  window.addEventListener(authStateChangedEventName, handleAuthEvent)

  clearStoredLogin()

  expect(eventCount).toBe(1)

  window.removeEventListener(authStateChangedEventName, handleAuthEvent)
})
