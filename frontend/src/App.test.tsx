// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

// US-34: every member-only and admin-only route sends a logged-out visitor to
// the log-in form instead of leaving a message on the guarded path. The
// redirect happens just after the first render, so wait for the login page and
// then check the URL. The heading is matched instead of the button of the same
// name, which is why the role is given.
async function expectRedirectToLogin() {
  expect(await screen.findByRole('heading', { name: 'Log in' })).toBeTruthy()
  expect(window.location.pathname).toBe('/login')
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

test('wires /admin/listings inside RequireAdmin for an administrator', async () => {
  window.history.pushState({}, '', '/admin/listings')
  window.localStorage.setItem('memberId', 'admin-1')
  window.localStorage.setItem('memberName', 'Alice Admin')

  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText === '/api/members/admin-1') {
      return makeFakeResponse(true, 200, {
        id: 'admin-1',
        name: 'Alice Admin',
        email: 'alice@example.com',
        role: 'admin',
        status: 'active',
      })
    }
    if (urlText === '/api/admin/listings') {
      return makeFakeResponse(true, 200, [])
    }
    return makeFakeResponse(true, 200, { unread_count: 0 })
  })

  render(<App />)

  expect(await screen.findByRole('heading', { name: 'Manage Listings' })).toBeTruthy()
})

test('guards the /dashboard route, redirecting to login when logged out', async () => {
  // No stored login. The dashboard is a member-only route, so App wraps it in
  // RequireAuth. This proves the guard is wired in App.tsx, not just correct in
  // isolation: the dashboard heading must not show, and the browser must end up
  // on /login.
  window.history.pushState({}, '', '/dashboard')
  render(<App />)

  await expectRedirectToLogin()
  expect(screen.queryByRole('heading', { name: 'Member Dashboard' })).toBeNull()
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

test('guards the /requests route, redirecting to login when logged out', async () => {
  // No stored login. The requests page is member-only, so App wraps it in
  // RequireAuth: the page heading must not show and the browser goes to /login.
  window.history.pushState({}, '', '/requests')
  render(<App />)

  await expectRedirectToLogin()
  expect(screen.queryByRole('heading', { name: 'Requests From Other Members' })).toBeNull()
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

test('guards the /my-requests route, redirecting to login when logged out', async () => {
  window.history.pushState({}, '', '/my-requests')
  render(<App />)

  await expectRedirectToLogin()
  expect(screen.queryByRole('heading', { name: 'Requests You Have Made' })).toBeNull()
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

test('guards the /my-listings route, redirecting to login when logged out', async () => {
  window.history.pushState({}, '', '/my-listings')
  render(<App />)

  await expectRedirectToLogin()
  expect(screen.queryByRole('heading', { name: 'Listings You Own' })).toBeNull()
})

// ── the routes that moved under RequireAuth, and the two new review routes ────

test('guards the /browse route, redirecting to login when logged out', async () => {
  // US-34 acceptance criterion 2: a logged-out visitor who types the browse URL
  // ends up on the log-in form with no listings shown.
  window.history.pushState({}, '', '/browse')
  render(<App />)

  await expectRedirectToLogin()
  expect(screen.queryByRole('heading', { name: 'Browse listings' })).toBeNull()
})

test('guards the /listings/:id route, redirecting to login when logged out', async () => {
  window.history.pushState({}, '', '/listings/abc')
  render(<App />)

  await expectRedirectToLogin()
})

test('guards the /exchange-reviews route, redirecting to login when logged out', async () => {
  window.history.pushState({}, '', '/exchange-reviews?claim=claim-1')
  render(<App />)

  await expectRedirectToLogin()
  expect(screen.queryByText(/Reviews for your exchange/)).toBeNull()
})

test('guards the /member-reviews route, redirecting to login when logged out', async () => {
  window.history.pushState({}, '', '/member-reviews?member=member-1&role=listing_owner')
  render(<App />)

  await expectRedirectToLogin()
  expect(screen.queryByText(/Reviews for/)).toBeNull()
})

test('wires the /exchange-reviews route for a logged-in member', async () => {
  window.history.pushState({}, '', '/exchange-reviews?claim=claim-1')
  window.localStorage.setItem('memberId', 'member-123')
  window.localStorage.setItem('memberName', 'Bob Baker')

  // Two fetches happen: the guard's member-profile check, then the page's own
  // reviews call. Both answer 200 here.
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/reviews')) {
      return makeFakeResponse(true, 200, {
        claim_id: 'claim-1',
        listing_title: 'Routed Lemons',
        reviews: [],
      })
    }
    return makeFakeResponse(true, 200, { id: 'member-123', name: 'Bob Baker' })
  })

  render(<App />)

  expect(
    await screen.findByRole('heading', { name: 'Reviews for your exchange: Routed Lemons' }),
  ).toBeTruthy()
})

test('wires the /member-reviews route for a logged-in member', async () => {
  window.history.pushState({}, '', '/member-reviews?member=member-9&role=requestor')
  window.localStorage.setItem('memberId', 'member-123')
  window.localStorage.setItem('memberName', 'Bob Baker')

  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/reviews')) {
      return makeFakeResponse(true, 200, {
        member_id: 'member-9',
        member_name: 'Carol Chen',
        role: 'requestor',
        average: null,
        count: 0,
        reviews: [],
      })
    }
    return makeFakeResponse(true, 200, { id: 'member-123', name: 'Bob Baker' })
  })

  render(<App />)

  expect(
    await screen.findByRole('heading', { name: 'Reviews for Carol Chen as a requestor' }),
  ).toBeTruthy()
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

test('guards the /profile/:id route, redirecting to login when logged out', async () => {
  window.history.pushState({}, '', '/profile/other-member-456')
  render(<App />)

  await expectRedirectToLogin()
  expect(screen.queryByRole('heading', { name: 'Carla' })).toBeNull()
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

test('guards the /admin/members route, redirecting to login when logged out', async () => {
  window.history.pushState({}, '', '/admin/members')
  render(<App />)

  await expectRedirectToLogin()
  expect(screen.queryByRole('heading', { name: 'Search members' })).toBeNull()
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

test('wires the /admin/reports route inside RequireAdmin for a logged-in admin', async () => {
  window.history.pushState({}, '', '/admin/reports')
  window.localStorage.setItem('memberId', 'admin-123')
  window.localStorage.setItem('memberName', 'Alice Admin')

  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, { id: 'admin-123', role: 'admin' })
  })

  render(<App />)

  // The reports page heading renders, which only happens if App registered
  // the route inside RequireAdmin and let a logged-in admin through.
  expect(await screen.findByRole('heading', { name: 'Activity report' })).toBeTruthy()
})

test('guards the /admin/reports route, redirecting to login when logged out', async () => {
  window.history.pushState({}, '', '/admin/reports')
  render(<App />)

  await expectRedirectToLogin()
  expect(screen.queryByRole('heading', { name: 'Activity report' })).toBeNull()
})

test('wires the /admin route inside RequireAdmin for a logged-in admin', async () => {
  window.history.pushState({}, '', '/admin')
  window.localStorage.setItem('memberId', 'admin-123')
  window.localStorage.setItem('memberName', 'Alice Admin')

  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText === '/api/admin/dashboard') {
      return makeFakeResponse(true, 200, {
        generated_at: '2026-07-30T00:00:00.000Z',
        active_listings: 0,
        open_requests: 0,
        members_currently_suspended: 0,
        open_member_reports_count: 0,
        recent_member_reports: [],
        recent_admin_actions: [],
      })
    }
    return makeFakeResponse(true, 200, { id: 'admin-123', role: 'admin' })
  })

  render(<App />)

  // The dashboard hub heading renders, which only happens if App registered
  // the route inside RequireAdmin and let a logged-in admin through.
  expect(await screen.findByRole('heading', { name: 'Admin Dashboard' })).toBeTruthy()
})

test('guards the /admin route, redirecting to login when logged out', async () => {
  window.history.pushState({}, '', '/admin')
  render(<App />)

  await expectRedirectToLogin()
  expect(screen.queryByRole('heading', { name: 'Admin Dashboard' })).toBeNull()
})

// US-34 criterion 6: Log out still lands on the home page.
//
// These two use the real App because the bug they catch comes from the guard
// and the shared nav reacting to the same click. Log out clears the stored
// login and navigates to "/" in one click, so the guard sees a cleared login
// while the router still reports the guarded path. Both fail with /login if the
// deferred update in RequireAuth or RequireAdmin is missing.

test('logging out from a member page lands on the home page, not the login page', async () => {
  window.history.pushState({}, '', '/my-listings')
  window.localStorage.setItem('memberId', 'member-123')
  window.localStorage.setItem('memberName', 'Bob Baker')

  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, [])
  })

  render(<App />)
  expect(await screen.findByRole('heading', { name: 'Listings You Own' })).toBeTruthy()

  fireEvent.click(screen.getAllByRole('link', { name: 'Log out' })[0])

  // Wait for the home page to render, not just for the URL to change,
  // so a redirect that arrived a render later would still be caught below.
  expect(await screen.findByRole('heading', { name: 'Welcome to Surplus' })).toBeTruthy()
  await waitFor(() => {
    expect(window.location.pathname).toBe('/')
  })
  expect(screen.queryByRole('heading', { name: 'Log in' })).toBeNull()
})

test('logging out from an admin page lands on the home page, not the login page', async () => {
  window.history.pushState({}, '', '/admin')
  window.localStorage.setItem('memberId', 'admin-123')
  window.localStorage.setItem('memberName', 'Alice Admin')

  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText === '/api/admin/dashboard') {
      return makeFakeResponse(true, 200, {
        generated_at: '2026-07-30T00:00:00.000Z',
        active_listings: 0,
        open_requests: 0,
        members_currently_suspended: 0,
        open_member_reports_count: 0,
        recent_member_reports: [],
        recent_admin_actions: [],
      })
    }
    return makeFakeResponse(true, 200, { id: 'admin-123', role: 'admin' })
  })

  render(<App />)
  expect(await screen.findByRole('heading', { name: 'Admin Dashboard' })).toBeTruthy()

  fireEvent.click(screen.getAllByRole('link', { name: 'Log out' })[0])

  // Wait for the home page to render, not just for the URL to change,
  // so a redirect that arrived a render later would still be caught below.
  expect(await screen.findByRole('heading', { name: 'Welcome to Surplus' })).toBeTruthy()
  await waitFor(() => {
    expect(window.location.pathname).toBe('/')
  })
  expect(screen.queryByRole('heading', { name: 'Log in' })).toBeNull()
})
