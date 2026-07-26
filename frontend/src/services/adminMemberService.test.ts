import { afterEach, expect, test, vi } from 'vitest'
import { getAdminMemberDetail, searchMembers, suspendMember, unsuspendMember } from './adminMemberService'

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

// ── searchMembers ──────────────────────────────────────────────────────────

test('searchMembers sends GET with the query string and the acting member header', async () => {
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) requestOptions = options
    return makeFakeResponse(true, 200, JSON.stringify([]))
  })

  const result = await searchMembers('carol', 'admin-1')

  expect(result.ok).toBe(true)
  expect(requestUrl).toBe('/api/admin/members?q=carol')
  expect(requestOptions.method).toBe('GET')
  const headers = requestOptions.headers as Record<string, string>
  expect(headers['X-Member-Id']).toBe('admin-1')
})

test('searchMembers returns ok:false on a 403 (non-admin caller)', async () => {
  vi.stubGlobal('fetch', async () =>
    makeFakeResponse(false, 403, JSON.stringify({ detail: 'Admin access required.' })),
  )

  const result = await searchMembers('carol', 'member-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(403)
})

test('searchMembers returns errorMessage on network timeout', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('timed out', 'TimeoutError')
  })

  const result = await searchMembers('carol', 'admin-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toContain('Timeout')
})

test('searchMembers returns errorMessage on generic network failure', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('Network unreachable')
  })

  const result = await searchMembers('carol', 'admin-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toContain('Request failed')
})

test('searchMembers preserves raw string when response body is not JSON', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 500, 'Internal Server Error'))

  const result = await searchMembers('carol', 'admin-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(500)
  expect(result.data).toBe('Internal Server Error')
})

// ── getAdminMemberDetail ──────────────────────────────────────────────────

test('getAdminMemberDetail requests the target id with the acting member header', async () => {
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) requestOptions = options
    return makeFakeResponse(true, 200, JSON.stringify({ id: 'member-2' }))
  })

  const result = await getAdminMemberDetail('member-2', 'admin-1')

  expect(result.ok).toBe(true)
  expect(requestUrl).toBe('/api/admin/members/member-2')
  const headers = requestOptions.headers as Record<string, string>
  expect(headers['X-Member-Id']).toBe('admin-1')
})

test('getAdminMemberDetail returns ok:false on a 404', async () => {
  vi.stubGlobal('fetch', async () =>
    makeFakeResponse(false, 404, JSON.stringify({ detail: 'Member not found.' })),
  )

  const result = await getAdminMemberDetail('missing-id', 'admin-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(404)
})

// ── suspendMember ──────────────────────────────────────────────────────────

test('suspendMember sends POST with the reason in the body', async () => {
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) requestOptions = options
    return makeFakeResponse(true, 200, JSON.stringify({ id: 'member-2', status: 'suspended' }))
  })

  const result = await suspendMember('member-2', 'admin-1', 'Repeated no-shows.')

  expect(result.ok).toBe(true)
  expect(requestUrl).toBe('/api/admin/members/member-2/suspend')
  expect(requestOptions.method).toBe('POST')
  const headers = requestOptions.headers as Record<string, string>
  expect(headers['X-Member-Id']).toBe('admin-1')
  expect(requestOptions.body).toBe(JSON.stringify({ reason: 'Repeated no-shows.' }))
})

test('suspendMember sends a null reason when left blank', async () => {
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options !== undefined) requestOptions = options
    return makeFakeResponse(true, 200, JSON.stringify({ id: 'member-2', status: 'suspended' }))
  })

  await suspendMember('member-2', 'admin-1', '   ')

  expect(requestOptions.body).toBe(JSON.stringify({ reason: null }))
})

test('suspendMember returns ok:false on a 409 (already suspended)', async () => {
  vi.stubGlobal('fetch', async () =>
    makeFakeResponse(false, 409, JSON.stringify({ detail: 'Member is already suspended.' })),
  )

  const result = await suspendMember('member-2', 'admin-1', '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(409)
})

// ── unsuspendMember ────────────────────────────────────────────────────────

test('unsuspendMember sends POST with no body', async () => {
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) requestOptions = options
    return makeFakeResponse(true, 200, JSON.stringify({ id: 'member-2', status: 'active' }))
  })

  const result = await unsuspendMember('member-2', 'admin-1')

  expect(result.ok).toBe(true)
  expect(requestUrl).toBe('/api/admin/members/member-2/unsuspend')
  expect(requestOptions.method).toBe('POST')
  expect(requestOptions.body).toBeUndefined()
})

test('unsuspendMember returns ok:false on a 409 (not suspended)', async () => {
  vi.stubGlobal('fetch', async () =>
    makeFakeResponse(false, 409, JSON.stringify({ detail: 'Member is not suspended.' })),
  )

  const result = await unsuspendMember('member-2', 'admin-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(409)
})
