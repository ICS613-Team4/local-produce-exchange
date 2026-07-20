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
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/api/request-queues')) {
      return makeFakeResponse(true, 200, { groups: [] })
    }
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
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/api/request-queues')) {
      return makeFakeResponse(true, 200, { groups: [] })
    }
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
  expect(screen.getByText('Valid JSON')).toBeTruthy()
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

test('wires the /requests route inside RequireAuth for a logged-in member', async () => {
  window.history.pushState({}, '', '/requests')
  window.localStorage.setItem('memberId', 'member-123')
  window.localStorage.setItem('memberName', 'Bob Baker')

  // RequireAuth validates the stored id, then the page loads its queues. A 200
  // for both lets the page render; an empty queue shows the global empty message.
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, { groups: [] })
  })

  render(<App />)

  // The requests page heading renders, which only happens if App registered the
  // route inside the RequireAuth group and let a logged-in member through.
  expect(await screen.findByRole('heading', { name: 'Requests From Other Members' })).toBeTruthy()
})

test('guards the /requests route, showing the log-in message when logged out', () => {
  // No stored login. The requests page is member-only, so App wraps it in
  // RequireAuth: the page heading must not show, the log-in message must.
  window.history.pushState({}, '', '/requests')
  render(<App />)

  expect(screen.queryByRole('heading', { name: 'Requests From Other Members' })).toBeNull()
  const loginLink = screen.getByRole('link', { name: 'log in' })
  expect(loginLink.getAttribute('href')).toBe('/login')
})

test('wires the /my-requests route inside RequireAuth for a logged-in member', async () => {
  window.history.pushState({}, '', '/my-requests')
  window.localStorage.setItem('memberId', 'member-123')
  window.localStorage.setItem('memberName', 'Bob Baker')

  // RequireAuth validates the stored id, then the page loads its requests. A 200
  // for both lets the page render; empty sections show the page's empty messages.
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, { pending: [], approved: [], denied: [] })
  })

  render(<App />)

  // The outgoing-requests page heading renders, which only happens if App
  // registered the route inside RequireAuth and let a logged-in member through.
  expect(await screen.findByRole('heading', { name: 'Requests You Have Made' })).toBeTruthy()
})

test('guards the /my-requests route, showing the log-in message when logged out', () => {
  window.history.pushState({}, '', '/my-requests')
  render(<App />)

  expect(screen.queryByRole('heading', { name: 'Requests You Have Made' })).toBeNull()
  const loginLink = screen.getByRole('link', { name: 'log in' })
  expect(loginLink.getAttribute('href')).toBe('/login')
})

test('wires the /my-listings route inside RequireAuth for a logged-in member', async () => {
  window.history.pushState({}, '', '/my-listings')
  window.localStorage.setItem('memberId', 'member-123')
  window.localStorage.setItem('memberName', 'Bob Baker')

  // RequireAuth validates the stored id, then the page loads its listings. A 200
  // for both lets the page render; an empty list shows the page's empty message.
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, [])
  })

  render(<App />)

  // The my-listings page heading renders, which only happens if App registered
  // the route inside RequireAuth and let a logged-in member through.
  expect(await screen.findByRole('heading', { name: 'Listings You Own' })).toBeTruthy()
})

test('guards the /my-listings route, showing the log-in message when logged out', () => {
  window.history.pushState({}, '', '/my-listings')
  render(<App />)

  expect(screen.queryByRole('heading', { name: 'Listings You Own' })).toBeNull()
  const loginLink = screen.getByRole('link', { name: 'log in' })
  expect(loginLink.getAttribute('href')).toBe('/login')
})

test('wires the /profile/:id route inside RequireAuth for a logged-in member', async () => {
  window.history.pushState({}, '', '/profile/other-member-456')
  window.localStorage.setItem('memberId', 'member-123')
  window.localStorage.setItem('memberName', 'Bob Baker')

  const otherMember = {
    id: 'other-member-456',
    name: 'Carla Carrot',
    email: 'carla@example.com',
    status: 'active',
    role: 'member',
    created_at: '2026-01-01T00:00:00Z',
    profile: { display_name: 'Carla', contact_preference: 'email', neighborhood: 'Manoa' },
  }
  // RequireAuth first validates member-123 (fetch for member-123), then the
  // page fetches the profile being viewed (other-member-456). Both hit the
  // same GET /api/members/:id shape, so one stub answers either.
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('other-member-456')) {
      return makeFakeResponse(true, 200, otherMember)
    }
    return makeFakeResponse(true, 200, { ...otherMember, id: 'member-123' })
  })

  render(<App />)

  // The read-only public view renders with the viewed member's display name,
  // which only happens if App registered the route inside RequireAuth and let
  // a logged-in member through.
  expect(await screen.findByRole('heading', { name: 'Carla' })).toBeTruthy()
})

test('guards the /profile/:id route, showing the log-in message when logged out', () => {
  window.history.pushState({}, '', '/profile/other-member-456')
  render(<App />)

  expect(screen.queryByRole('heading', { name: 'Carla' })).toBeNull()
  const loginLink = screen.getByRole('link', { name: 'log in' })
  expect(loginLink.getAttribute('href')).toBe('/login')
})

test('wires the /admin/members route inside RequireAdmin for a logged-in admin', async () => {
  window.history.pushState({}, '', '/admin/members')
  window.localStorage.setItem('memberId', 'admin-123')
  window.localStorage.setItem('memberName', 'Alice Admin')

  // RequireAdmin validates admin-123 via GET /api/members/:id, checking role.
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, { id: 'admin-123', role: 'admin' })
  })

  render(<App />)

  // The search page heading renders, which only happens if App registered the
  // route inside RequireAdmin and let a logged-in admin through.
  expect(await screen.findByRole('heading', { name: 'Search members' })).toBeTruthy()
})

test('blocks the /admin/members route for a logged-in member who is not an admin', async () => {
  window.history.pushState({}, '', '/admin/members')
  window.localStorage.setItem('memberId', 'member-123')
  window.localStorage.setItem('memberName', 'Bob Baker')

  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, { id: 'member-123', role: 'member' })
  })

  render(<App />)

  expect(await screen.findByText(/do not have access/)).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Search members' })).toBeNull()
})

test('guards the /admin/members route, showing the log-in message when logged out', () => {
  window.history.pushState({}, '', '/admin/members')
  render(<App />)

  expect(screen.queryByRole('heading', { name: 'Search members' })).toBeNull()
  const loginLink = screen.getByRole('link', { name: 'log in' })
  expect(loginLink.getAttribute('href')).toBe('/login')
})

test('wires the /admin/members/:id route inside RequireAdmin for a logged-in admin', async () => {
  window.history.pushState({}, '', '/admin/members/member-456')
  window.localStorage.setItem('memberId', 'admin-123')
  window.localStorage.setItem('memberName', 'Alice Admin')

  const targetMember = {
    id: 'member-456',
    name: 'Carla Carrot',
    email: 'carla@example.com',
    status: 'active',
    role: 'member',
    created_at: '2026-01-01T00:00:00Z',
    suspended_at: null,
    display_name: 'Carla',
    neighborhood: 'Manoa',
    contact_preference: 'email',
  }
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('member-456')) {
      return makeFakeResponse(true, 200, targetMember)
    }
    return makeFakeResponse(true, 200, { id: 'admin-123', role: 'admin' })
  })

  render(<App />)

  expect(await screen.findByRole('heading', { name: 'Carla Carrot' })).toBeTruthy()
})
