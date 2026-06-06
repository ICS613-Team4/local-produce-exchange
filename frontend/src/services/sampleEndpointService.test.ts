import { afterEach, expect, test, vi } from 'vitest'

import { sampleEndpointTimeoutMilliseconds, sendSampleEndpointRequest } from './sampleEndpointService'

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

test('posts JSON and parses a JSON response', async () => {
  const responseBody = {
    message: 'Payload accepted',
    baz: 123,
  }
  const requestBody = '{"foo":"bar","baz":123}'
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) {
      requestOptions = options
    }
    return makeFakeResponse(true, 200, JSON.stringify(responseBody))
  })

  const result = await sendSampleEndpointRequest(requestBody)

  expect(result.ok).toBe(true)
  expect(result.status).toBe(200)
  expect(JSON.stringify(result.data)).toBe(JSON.stringify(responseBody))
  expect(result.errorMessage).toBe('')
  expect(requestUrl).toBe('/api/sample-endpoint')
  expect(requestOptions.method).toBe('POST')
  expect(JSON.stringify(requestOptions.headers)).toContain('application/json')
  expect(requestOptions.body).toBe(requestBody)
  expect(requestOptions.signal).toBeTruthy()
})

test('keeps a plain text response body', async () => {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 502, 'Bad Gateway')
  })

  const result = await sendSampleEndpointRequest('{"foo":"bar","baz":123}')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(502)
  expect(result.data).toBe('Bad Gateway')
  expect(result.errorMessage).toBe('')
})

test('returns a timeout message when fetch times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  const result = await sendSampleEndpointRequest('{"foo":"bar","baz":123}')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe(
    'Timeout: no answer from the backend after ' + sampleEndpointTimeoutMilliseconds + ' ms.',
  )
})

test('returns a request failure message when fetch rejects', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  const result = await sendSampleEndpointRequest('{"foo":"bar","baz":123}')

  expect(result.ok).toBe(false)
  expect(result.status).toBe(0)
  expect(result.errorMessage).toBe('Request failed: TypeError: Failed to fetch')
})
