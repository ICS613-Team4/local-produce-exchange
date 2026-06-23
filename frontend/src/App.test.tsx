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

test('wires the /browse route to the browse page when a member is logged in', async () => {
  window.history.pushState({}, '', '/browse')
  window.localStorage.setItem('memberId', 'member-123')
  window.localStorage.setItem('memberName', 'Bob Baker')

  // The browse page loads the full list on open, so answer that fetch.
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, [])
  })

  render(<App />)

  // The browse page heading renders, which only happens if App registered the
  // route.
  expect(await screen.findByRole('heading', { name: 'Browse listings' })).toBeTruthy()
})

test('wires the /test route to the test page for a logged-out visitor', () => {
  // No stored login here, which proves the Test page is open to everyone.
  window.history.pushState({}, '', '/test')
  render(<App />)

  // The page heading (not the nav link of the same name) renders, which only
  // happens if App registered the route.
  expect(screen.getByRole('heading', { name: 'Test Page' })).toBeTruthy()
  expect(screen.getByText('Call backend API with valid JSON')).toBeTruthy()
})

test('guards the /dashboard route, showing the log-in message when logged out', () => {
  // No stored login. The dashboard is a member-only route, so App wraps it in
  // RequireAuth. This proves the guard is wired in App.tsx, not just correct in
  // isolation: the dashboard heading must not show, the log-in message must.
  window.history.pushState({}, '', '/dashboard')
  render(<App />)

  expect(screen.queryByRole('heading', { name: 'Member Dashboard' })).toBeNull()
  const loginLink = screen.getByRole('link', { name: 'log in' })
  expect(loginLink.getAttribute('href')).toBe('/login')
})
