// @vitest-environment jsdom

import { afterEach, expect, test, vi } from 'vitest'

import { downloadAuditLogPdf, getAuditLog } from './adminAuditLogService'

type FakeResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function makeFakeResponse(ok: boolean, status: number, bodyText: string): FakeResponse {
  return { ok, status, text: async () => bodyText }
}

// ── getAuditLog ──────────────────────────────────────────────────────────────

test('getAuditLog GETs with no query params when no dates are given', async () => {
  let requestUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    requestUrl = String(url)
    return makeFakeResponse(true, 200, JSON.stringify({ entries: [], total_count: 0, start_date: null, end_date: null }))
  })

  const result = await getAuditLog('admin-1', '', '')

  expect(requestUrl).toBe('/api/admin/audit-log')
  expect(result.ok).toBe(true)
})

test('getAuditLog includes start_date and end_date when given', async () => {
  let requestUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    requestUrl = String(url)
    return makeFakeResponse(true, 200, JSON.stringify({ entries: [], total_count: 0, start_date: '2026-01-01', end_date: '2026-02-01' }))
  })

  await getAuditLog('admin-1', '2026-01-01', '2026-02-01')

  expect(requestUrl).toBe('/api/admin/audit-log?start_date=2026-01-01&end_date=2026-02-01')
})

test('getAuditLog sends the acting member header', async () => {
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options !== undefined) {
      requestOptions = options
    }
    return makeFakeResponse(true, 200, JSON.stringify({ entries: [], total_count: 0, start_date: null, end_date: null }))
  })

  await getAuditLog('admin-1', '', '')

  expect(JSON.stringify(requestOptions.headers)).toContain('admin-1')
})

test('getAuditLog surfaces a non-OK status with the detail preserved', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 503, JSON.stringify({ detail: 'Could not load the audit log right now.' })))

  const result = await getAuditLog('admin-1', '', '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(503)
  expect(result.data).toEqual({ detail: 'Could not load the audit log right now.' })
})

test('getAuditLog reports a timeout distinctly from other failures', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('timed out', 'TimeoutError')
  })

  const result = await getAuditLog('admin-1', '', '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toContain('Timeout')
})

// ── downloadAuditLogPdf ──────────────────────────────────────────────────────

test('downloadAuditLogPdf GETs the export endpoint and triggers a browser download', async () => {
  let requestUrl = ''
  const fakeBlob = new Blob(['%PDF-1.4'], { type: 'application/pdf' })
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    requestUrl = String(url)
    return {
      ok: true,
      status: 200,
      blob: async () => fakeBlob,
    }
  })
  const createObjectURL = vi.fn(() => 'blob:fake-url')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

  const outcome = await downloadAuditLogPdf('admin-1', '2026-01-01', '')

  expect(requestUrl).toBe('/api/admin/audit-log/export?start_date=2026-01-01')
  expect(outcome.ok).toBe(true)
  expect(createObjectURL).toHaveBeenCalledWith(fakeBlob)
  expect(anchorClick).toHaveBeenCalledOnce()
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url')
})

test('downloadAuditLogPdf reports a non-OK status without attempting a download', async () => {
  vi.stubGlobal('fetch', async () => ({ ok: false, status: 401 }))
  const createObjectURL = vi.fn()
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })

  const outcome = await downloadAuditLogPdf('admin-1', '', '')

  expect(outcome.ok).toBe(false)
  expect(outcome.status).toBe(401)
  expect(createObjectURL).not.toHaveBeenCalled()
})

test('downloadAuditLogPdf reports a timeout distinctly from other failures', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('timed out', 'TimeoutError')
  })

  const outcome = await downloadAuditLogPdf('admin-1', '', '')

  expect(outcome.ok).toBe(false)
  expect(outcome.status).toBe(0)
  expect(outcome.errorMessage).toContain('Timeout')
})
