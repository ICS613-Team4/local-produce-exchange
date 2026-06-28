import { afterEach, expect, test, vi } from 'vitest'
import { getMemberProfile, updateMemberProfile } from './memberService'

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

const fakeMember = {
  id: 'member-1',
  name: 'Alice',
  email: 'alice@example.com',
  status: 'active',
  role: 'member',
  created_at: '2026-01-01T00:00:00Z',
  profile: null,
}

// ── getMemberProfile ──────────────────────────────────────────────────────────

test('getMemberProfile sends GET to the correct URL with X-Member-Id header', async () => {
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) requestOptions = options
    return makeFakeResponse(true, 200, JSON.stringify(fakeMember))
  })

  const result = await getMemberProfile('member-1')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(fakeMember))
  expect(requestUrl).toBe('/api/members/member-1')
  expect(requestOptions.method).toBe('GET')
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-1')
})

test('getMemberProfile returns ok:false on non-200 response', async () => {
  vi.stubGlobal('fetch', async () =>
    makeFakeResponse(false, 404, JSON.stringify({ detail: 'Member not found.' })),
  )

  const result = await getMemberProfile('member-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(404)
})

test('getMemberProfile preserves raw string when response body is not JSON', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 500, 'Internal Server Error'))

  const result = await getMemberProfile('member-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(500)
  expect(result.data).toBe('Internal Server Error')
})

test('getMemberProfile returns errorMessage on network timeout', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('timed out', 'TimeoutError')
  })

  const result = await getMemberProfile('member-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toContain('Timeout')
})

test('getMemberProfile returns errorMessage on generic network failure', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('Network unreachable')
  })

  const result = await getMemberProfile('member-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toContain('Request failed')
})

// ── updateMemberProfile ───────────────────────────────────────────────────────

test('updateMemberProfile sends PATCH with body JSON to the correct URL', async () => {
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  const payload = { display_name: 'Alice A.', neighborhood: 'Westside' }
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) requestOptions = options
    return makeFakeResponse(true, 200, JSON.stringify({ ...fakeMember, profile: payload }))
  })

  const result = await updateMemberProfile('member-1', payload)

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(requestUrl).toBe('/api/members/member-1')
  expect(requestOptions.method).toBe('PATCH')
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(requestOptions.body).toBe(JSON.stringify(payload))
})

test('updateMemberProfile returns ok:false on non-200 response', async () => {
  vi.stubGlobal('fetch', async () =>
    makeFakeResponse(false, 403, JSON.stringify({ detail: 'Forbidden.' })),
  )

  const result = await updateMemberProfile('member-1', { display_name: 'Alice' })

  expect(result.ok).toBe(false)
  expect(result.status).toBe(403)
})
