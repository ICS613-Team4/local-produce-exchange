// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import DashboardPage from './DashboardPage'

type FakeResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
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

// Renders the dashboard at /dashboard. The page no longer reads navigation
// state, so the helper takes no arguments.
function renderDashboard() {
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

test('shows the title and the member action links', () => {
  renderDashboard()

  expect(screen.getByRole('heading', { name: 'Member Dashboard' })).toBeTruthy()

  // The Browse listings link is the way into the new US-06 browse page.
  const browseLink = screen.getByRole('link', { name: 'Browse listings' })
  expect(browseLink.getAttribute('href')).toBe('/browse')

  const createLink = screen.getByRole('link', { name: 'Create a listing' })
  expect(createLink.getAttribute('href')).toBe('/listings/create')

  // Moved here from the nav, so the dashboard is the one place that gathers the
  // member actions.
  const inviteLink = screen.getByRole('link', { name: 'Invite a new member' })
  expect(inviteLink.getAttribute('href')).toBe('/invite')

  const profileLink = screen.getByRole('link', { name: 'View profile' })
  expect(profileLink.getAttribute('href')).toBe('/profile')
})

test('shows the latest-listings preview for a logged-in member', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) {
      requestOptions = options
    }
    const listings = [
      {
        id: 'l1',
        owner_id: 'member-999',
        title: 'Backyard Meyer Lemons',
        description: 'Citrus.',
        category: 'Fruit',
        total_quantity: 5,
        remaining_quantity: 5,
        dietary_tags: [],
        allergen_tags: [],
        pickup_start: '2026-07-01T09:00:00.000Z',
        pickup_end: '2026-07-01T11:00:00.000Z',
        status: 'active',
        created_at: '2026-06-19T00:00:00.000Z',
      },
    ]
    return makeFakeResponse(true, 200, listings)
  })

  renderDashboard()

  // The preview lists the latest titles, each linking to its detail page.
  const previewLink = await screen.findByRole('link', { name: 'Backyard Meyer Lemons' })
  expect(previewLink.getAttribute('href')).toBe('/listings/l1')

  // The preview asks for the five newest listings with the stored member id.
  expect(requestUrl).toBe('/api/listings?limit=5')
  expect(JSON.stringify(requestOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(requestOptions.headers)).toContain('member-123')
})

test('does not request the preview when logged out', () => {
  let fetchWasCalled = false
  vi.stubGlobal('fetch', async () => {
    fetchWasCalled = true
    return makeFakeResponse(true, 200, [])
  })

  renderDashboard()

  // No stored memberId, so the preview request is skipped entirely.
  expect(fetchWasCalled).toBe(false)
})

test('shows the empty preview message when there are no listings', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, [])
  })

  renderDashboard()

  expect(await screen.findByText('No listings yet.')).toBeTruthy()
})

test('shows a transport error in the preview when the request times out', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  renderDashboard()

  expect(await screen.findByText(/Timeout: no answer from the backend/)).toBeTruthy()
})

test('shows an error in the preview on an HTTP failure', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 503, { detail: 'down' })
  })

  renderDashboard()

  expect(await screen.findByText('Could not load the latest listings.')).toBeTruthy()
})
