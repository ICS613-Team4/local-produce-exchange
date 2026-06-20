// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import App from './App'

type FakeResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
  // Reset the URL so the next test starts at the root.
  window.history.pushState({}, '', '/')
})

function makeFakeResponse(ok: boolean, status: number, body: object): FakeResponse {
  const bodyText = JSON.stringify(body)
  const fakeResponse = {
    ok: ok,
    status: status,
    text: async () => {
      return bodyText
    },
  }
  return fakeResponse
}

test('wires the /listings/:id route to the listing detail page', async () => {
  // App uses BrowserRouter, which reads the real window.location, so set the URL
  // before rendering. The page tests mount their own route, so this is the one
  // test that proves App.tsx itself registers the detail route.
  window.history.pushState({}, '', '/listings/abc')
  window.localStorage.setItem('memberId', 'member-123')
  window.localStorage.setItem('memberName', 'Bob Baker')

  const listing = {
    id: 'abc',
    owner_id: 'member-123',
    title: 'Routed Lemons',
    description: 'Reached through the real App route.',
    category: 'Fruit',
    total_quantity: 5,
    remaining_quantity: 5,
    dietary_tags: ['vegan'],
    allergen_tags: [],
    pickup_start: '2026-07-01T09:00:00.000Z',
    pickup_end: '2026-07-01T11:00:00.000Z',
    status: 'active',
    created_at: '2026-06-19T00:00:00.000Z',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, listing)
  })

  render(<App />)

  // The detail content renders, which only happens if App registered the route.
  expect(await screen.findByText('Routed Lemons')).toBeTruthy()
})

test('wires the /listings/:id/edit route to the edit listing page', async () => {
  window.history.pushState({}, '', '/listings/abc/edit')
  window.localStorage.setItem('memberId', 'member-123')
  window.localStorage.setItem('memberName', 'Bob Baker')

  const listing = {
    id: 'abc',
    owner_id: 'member-123',
    title: 'Routed Lemons',
    description: 'Reached through the real edit route.',
    category: 'Fruit',
    total_quantity: 5,
    remaining_quantity: 5,
    dietary_tags: ['vegan'],
    allergen_tags: [],
    pickup_start: '2026-07-01T09:00:00.000Z',
    pickup_end: '2026-07-01T11:00:00.000Z',
    status: 'active',
    created_at: '2026-06-19T00:00:00.000Z',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, listing)
  })

  render(<App />)

  expect(await screen.findByRole('button', { name: 'Save changes' })).toBeTruthy()
})
