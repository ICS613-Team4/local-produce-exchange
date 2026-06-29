import { afterEach, expect, test, vi } from 'vitest'
import { getThread, sendMessage } from './threadService'

type FakeResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function makeFakeResponse(ok: boolean, status: number, bodyText: string): FakeResponse {
  return { ok, status, text: async () => bodyText }
}

const fakeThread = {
  id: 'thread-1',
  claim_id: 'claim-1',
  created_at: '2026-06-28T10:00:00Z',
  messages: [],
}

test('getThread sends GET to the correct URL with X-Member-Id header', async () => {
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) requestOptions = options
    return makeFakeResponse(true, 200, JSON.stringify(fakeThread))
  })

  const result = await getThread('member-abc', 'claim-1')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(fakeThread))
  expect(requestUrl).toBe('/api/claims/claim-1/thread')
  expect(requestOptions.method).toBe('GET')
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-abc')
  expect(requestOptions.signal).toBeTruthy()
})

test('sendMessage sends POST with body JSON to the correct URL', async () => {
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  const fakeMessage = {
    id: 'msg-1',
    thread_id: 'thread-1',
    sender_id: 'member-abc',
    sender_name: 'Alice',
    body: 'Hello!',
    sent_at: '2026-06-28T10:01:00Z',
  }
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) requestOptions = options
    return makeFakeResponse(true, 201, JSON.stringify(fakeMessage))
  })

  const result = await sendMessage('member-abc', 'claim-1', 'Hello!')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(201)
  expect(requestUrl).toBe('/api/claims/claim-1/thread/messages')
  expect(requestOptions.method).toBe('POST')
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(requestOptions.body).toBe(JSON.stringify({ body: 'Hello!' }))
  expect(requestOptions.signal).toBeTruthy()
})

test('getThread returns errorMessage on network timeout', async () => {
  vi.stubGlobal('fetch', async () => {
    const err = new DOMException('timed out', 'TimeoutError')
    throw err
  })

  const result = await getThread('member-abc', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toContain('Timeout')
})

test('getThread returns ok:false on non-200 response', async () => {
  vi.stubGlobal('fetch', async () =>
    makeFakeResponse(false, 403, JSON.stringify({ detail: 'You are not a party to this exchange.' })),
  )

  const result = await getThread('member-abc', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(403)
})

test('getThread preserves raw string when response body is not JSON', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 500, 'Internal Server Error'))

  const result = await getThread('member-abc', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(500)
  expect(result.data).toBe('Internal Server Error')
})

test('getThread returns errorMessage on generic network failure', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('Network unreachable')
  })

  const result = await getThread('member-abc', 'claim-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toContain('Request failed')
})
