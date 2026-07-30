import { afterEach, expect, test, vi } from 'vitest'

import { memberReportTimeoutMilliseconds, sendCreateMemberReportRequest } from './memberReportService'

type FakeResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function makeFakeResponse(ok: boolean, status: number, bodyText: string): FakeResponse {
  return {
    ok: ok,
    status: status,
    text: async () => bodyText,
  }
}

test('create POSTs the category and detail with the acting member header', async () => {
  const responseBody = { id: 'report-1', target_member_id: 'member-2', category: 'harassment', detail: 'Rude.', status: 'open', created_at: '2026-07-29T00:00:00.000Z' }
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) {
      requestOptions = options
    }
    return makeFakeResponse(true, 201, JSON.stringify(responseBody))
  })

  const result = await sendCreateMemberReportRequest('member-1', 'member-2', 'harassment', 'Rude.')

  expect(requestUrl).toBe('/api/members/member-2/reports')
  expect(requestOptions.method).toBe('POST')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-1')
  expect(requestOptions.body).toBe(JSON.stringify({ category: 'harassment', detail: 'Rude.' }))
  expect(result.ok).toBe(true)
  expect(result.status).toBe(201)
  expect(result.data).toEqual(responseBody)
})

test('create sends null detail when the caller left it blank', async () => {
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options !== undefined) {
      requestOptions = options
    }
    return makeFakeResponse(true, 201, JSON.stringify({}))
  })

  await sendCreateMemberReportRequest('member-1', 'member-2', 'other', '')

  expect(requestOptions.body).toBe(JSON.stringify({ category: 'other', detail: null }))
})

test('create surfaces a non-OK status with the detail preserved', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 409, JSON.stringify({ detail: 'You already have an open report against this member.' }))
  })

  const result = await sendCreateMemberReportRequest('member-1', 'member-2', 'harassment', '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(409)
  expect(result.data).toEqual({ detail: 'You already have an open report against this member.' })
})

test('create preserves a plain-text body it cannot parse as JSON', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 502, 'Bad Gateway')
  })

  const result = await sendCreateMemberReportRequest('member-1', 'member-2', 'harassment', '')

  expect(result.data).toBe('Bad Gateway')
})

test('create reports a timeout distinctly from other failures', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendCreateMemberReportRequest('member-1', 'member-2', 'harassment', '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toContain(String(memberReportTimeoutMilliseconds))
})

test('create reports a generic failure when fetch rejects for another reason', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  const result = await sendCreateMemberReportRequest('member-1', 'member-2', 'harassment', '')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toContain('Request failed')
})
