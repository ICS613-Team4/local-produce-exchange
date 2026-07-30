import { afterEach, expect, test, vi } from 'vitest'

import { listMemberReports, resolveMemberReport } from './adminMemberReportService'

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

test('listMemberReports GETs with the status filter and member header', async () => {
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) {
      requestOptions = options
    }
    return makeFakeResponse(true, 200, JSON.stringify([]))
  })

  await listMemberReports('admin-1', 'open')

  expect(requestUrl).toBe('/api/admin/member-reports?status=open')
  expect(requestOptions.method).toBe('GET')
  expect(JSON.stringify(requestOptions.headers)).toContain('admin-1')
})

test('listMemberReports defaults to the open status', async () => {
  let requestUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    requestUrl = String(url)
    return makeFakeResponse(true, 200, JSON.stringify([]))
  })

  await listMemberReports('admin-1')

  expect(requestUrl).toBe('/api/admin/member-reports?status=open')
})

test('resolveMemberReport POSTs the trimmed note', async () => {
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) {
      requestOptions = options
    }
    return makeFakeResponse(true, 204, '')
  })

  await resolveMemberReport('report-1', 'admin-1', '  Talked to the member.  ')

  expect(requestUrl).toBe('/api/admin/member-reports/report-1/resolve')
  expect(requestOptions.method).toBe('POST')
  expect(requestOptions.body).toBe(JSON.stringify({ resolution_note: 'Talked to the member.' }))
})

test('resolveMemberReport sends null for a blank note', async () => {
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options !== undefined) {
      requestOptions = options
    }
    return makeFakeResponse(true, 204, '')
  })

  await resolveMemberReport('report-1', 'admin-1', '   ')

  expect(requestOptions.body).toBe(JSON.stringify({ resolution_note: null }))
})

test('resolveMemberReport surfaces a non-OK status with the detail preserved', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 404, JSON.stringify({ detail: 'Report not found.' })))

  const result = await resolveMemberReport('report-1', 'admin-1', '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(404)
  expect(result.data).toEqual({ detail: 'Report not found.' })
})

test('reports a timeout distinctly from other failures', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('timed out', 'TimeoutError')
  })

  const result = await listMemberReports('admin-1')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toContain('Timeout')
})
