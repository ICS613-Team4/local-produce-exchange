import { afterEach, expect, test, vi } from 'vitest'

import {
  getAdminListings,
  updateAdminListingStatus,
} from './adminListingService'

type FakeResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
}

function makeFakeResponse(ok: boolean, status: number, bodyText: string): FakeResponse {
  return {
    ok,
    status,
    text: async () => bodyText,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

test('loads the admin listing inventory with the member id header', async () => {
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options?: RequestInit) => {
    requestUrl = String(url)
    requestOptions = options ?? {}
    return makeFakeResponse(true, 200, JSON.stringify([
      {
        id: 'listing-1',
        owner_id: 'owner-1',
        owner_name: 'Olivia Owner',
        title: 'Fresh Tomatoes',
        status: 'active',
        deactivated_by: null,
      },
    ]))
  })

  const result = await getAdminListings('admin-1')

  expect(result.ok).toBe(true)
  expect(requestUrl).toBe('/api/admin/listings')
  expect(requestOptions.method).toBe('GET')
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).toContain('admin-1')
})

test('posts the requested admin listing status action with no body', async () => {
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options?: RequestInit) => {
    requestUrl = String(url)
    requestOptions = options ?? {}
    return makeFakeResponse(true, 204, '')
  })

  const result = await updateAdminListingStatus('listing-1', 'admin-1', 'deactivate')

  expect(result.ok).toBe(true)
  expect(result.status).toBe(204)
  expect(requestUrl).toBe('/api/admin/listings/listing-1/deactivate')
  expect(requestOptions.method).toBe('POST')
  expect(requestOptions.body).toBeUndefined()
  expect(JSON.stringify(requestOptions.headers)).toContain('admin-1')
})
