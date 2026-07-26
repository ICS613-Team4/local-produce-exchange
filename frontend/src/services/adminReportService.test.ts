import { afterEach, expect, test, vi } from 'vitest'
import { generateReport } from './adminReportService'

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

test('generateReport requests with no query string when both dates are blank', async () => {
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) requestOptions = options
    return makeFakeResponse(true, 200, JSON.stringify({ total_listings: 0 }))
  })

  const result = await generateReport('admin-1', '', '')

  expect(result.ok).toBe(true)
  expect(requestUrl).toBe('/api/admin/reports')
  expect(requestOptions.method).toBe('GET')
  const headers = requestOptions.headers as Record<string, string>
  expect(headers['X-Member-Id']).toBe('admin-1')
})

test('generateReport sends both dates as query params when given', async () => {
  let requestUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    requestUrl = String(url)
    return makeFakeResponse(true, 200, JSON.stringify({ total_listings: 0 }))
  })

  await generateReport('admin-1', '2026-06-01', '2026-06-30')

  expect(requestUrl).toBe('/api/admin/reports?start_date=2026-06-01&end_date=2026-06-30')
})

test('generateReport sends only the start date when the end date is blank', async () => {
  let requestUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    requestUrl = String(url)
    return makeFakeResponse(true, 200, JSON.stringify({ total_listings: 0 }))
  })

  await generateReport('admin-1', '2026-06-01', '')

  expect(requestUrl).toBe('/api/admin/reports?start_date=2026-06-01')
})

test('generateReport returns ok:false on a 422 (start after end)', async () => {
  vi.stubGlobal('fetch', async () =>
    makeFakeResponse(false, 422, JSON.stringify({ detail: 'start_date must not be after end_date.' })),
  )

  const result = await generateReport('admin-1', '2026-07-01', '2026-06-01')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(422)
})

test('generateReport returns ok:false on a 403 (non-admin caller)', async () => {
  vi.stubGlobal('fetch', async () =>
    makeFakeResponse(false, 403, JSON.stringify({ detail: 'Admin access required.' })),
  )

  const result = await generateReport('member-1', '', '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(403)
})

test('generateReport returns errorMessage on network timeout', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('timed out', 'TimeoutError')
  })

  const result = await generateReport('admin-1', '', '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toContain('Timeout')
})

test('generateReport returns errorMessage on generic network failure', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('Network unreachable')
  })

  const result = await generateReport('admin-1', '', '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toContain('Request failed')
})

test('generateReport preserves raw string when response body is not JSON', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 500, 'Internal Server Error'))

  const result = await generateReport('admin-1', '', '')

  expect(result.ok).toBe(false)
  expect(result.data).toBe('Internal Server Error')
})
