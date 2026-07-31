import { afterEach, expect, test, vi } from 'vitest'

import { getAdminDashboardSnapshot } from './adminDashboardService'

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

test('GETs the dashboard endpoint with the acting member header', async () => {
  const responseBody = { active_listings: 1 }
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) {
      requestOptions = options
    }
    return makeFakeResponse(true, 200, JSON.stringify(responseBody))
  })

  const result = await getAdminDashboardSnapshot('admin-1')

  expect(requestUrl).toBe('/api/admin/dashboard')
  expect(requestOptions.method).toBe('GET')
  expect(JSON.stringify(requestOptions.headers)).toContain('admin-1')
  expect(result.ok).toBe(true)
  expect(result.data).toEqual(responseBody)
})

test('surfaces a non-OK status with the detail preserved', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 503, JSON.stringify({ detail: 'Could not load the admin dashboard right now.' })))

  const result = await getAdminDashboardSnapshot('admin-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(503)
  expect(result.data).toEqual({ detail: 'Could not load the admin dashboard right now.' })
})

test('reports a timeout distinctly from other failures', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('timed out', 'TimeoutError')
  })

  const result = await getAdminDashboardSnapshot('admin-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toContain('Timeout')
})

test('reports a generic failure when fetch rejects for another reason', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  const result = await getAdminDashboardSnapshot('admin-1')

  expect(result.ok).toBe(false)
  expect(result.errorMessage).toContain('Request failed')
})
