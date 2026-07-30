// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import AdminDashboardPage from './AdminDashboardPage'

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

function makeFakeResponse(ok: boolean, status: number, body: unknown): FakeResponse {
  return { ok, status, text: async () => JSON.stringify(body) }
}

function renderDashboardPage() {
  window.localStorage.setItem('memberId', 'admin-1')
  render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>,
  )
}

function makeSnapshot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    generated_at: '2026-07-29T00:00:00.000Z',
    active_listings: 4,
    open_requests: 2,
    members_currently_suspended: 1,
    open_member_reports_count: 1,
    recent_member_reports: [
      {
        id: 'report-1',
        reporter_id: 'reporter-1',
        reporter_name: 'Reporter One',
        target_member_id: 'target-1',
        target_name: 'Target One',
        category: 'harassment',
        detail: 'Was rude.',
        status: 'open',
        created_at: '2026-07-29T00:00:00.000Z',
        resolved_at: null,
        resolved_by: null,
        resolution_note: null,
      },
    ],
    recent_admin_actions: [
      {
        id: 'entry-1',
        admin_id: 'admin-1',
        admin_name: 'Admin Alice',
        action: 'member_suspended',
        target_type: 'member',
        target_id: 'member-2',
        target_label: 'Bob Baker',
        reason: 'Repeated no-shows.',
        created_at: '2026-07-29T00:00:00.000Z',
      },
    ],
    ...overrides,
  }
}

test('shows the heading', () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeSnapshot()))
  renderDashboardPage()

  expect(screen.getByRole('heading', { name: 'Admin Dashboard' })).toBeTruthy()
})

test('links to the member search page', () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeSnapshot()))
  renderDashboardPage()

  const link = screen.getByRole('link', { name: /Manage Members/ })
  expect(link.getAttribute('href')).toBe('/admin/members')
})

test('links to the listings management page', () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeSnapshot()))
  renderDashboardPage()

  const link = screen.getByRole('link', { name: /Manage Listings/ })
  expect(link.getAttribute('href')).toBe('/admin/listings')
})

test('links to the activity report page', () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeSnapshot()))
  renderDashboardPage()

  const link = screen.getByRole('link', { name: /Activity Report/ })
  expect(link.getAttribute('href')).toBe('/admin/reports')
})

test('links to the audit log page', () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeSnapshot()))
  renderDashboardPage()

  const link = screen.getByRole('link', { name: /Audit Log/ })
  expect(link.getAttribute('href')).toBe('/admin/audit-log')
})

test('shows the live stat tiles once loaded', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeSnapshot()))
  renderDashboardPage()

  expect(await screen.findByText('4')).toBeTruthy()
  expect(screen.getByText('Active listings')).toBeTruthy()
  expect(screen.getByText('Currently suspended members')).toBeTruthy()
})

test('shows open member reports with reporter and target', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeSnapshot()))
  renderDashboardPage()

  expect(await screen.findByText('Reporter One', { exact: false })).toBeTruthy()
  expect(screen.getByText('Was rude.')).toBeTruthy()
})

test('shows a no-reports message when there are none open', async () => {
  vi.stubGlobal('fetch', async () =>
    makeFakeResponse(true, 200, makeSnapshot({ recent_member_reports: [], open_member_reports_count: 0 })),
  )
  renderDashboardPage()

  expect(await screen.findByText('No open reports.')).toBeTruthy()
})

test('shows recent admin actions', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeSnapshot()))
  renderDashboardPage()

  expect(await screen.findByText('member suspended')).toBeTruthy()
  const link = screen.getByRole('link', { name: 'View full audit log →' })
  expect(link.getAttribute('href')).toBe('/admin/audit-log')
})

test('resolving a report removes it from the panel after confirming', async () => {
  vi.stubGlobal('confirm', () => true)
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options?.method === 'POST') {
      return makeFakeResponse(true, 204, {})
    }
    return makeFakeResponse(true, 200, makeSnapshot())
  })
  renderDashboardPage()

  await screen.findByText('Reporter One', { exact: false })
  fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))

  await waitFor(() => {
    expect(screen.getByText('No open reports.')).toBeTruthy()
  })
})

test('resolving a report does nothing when the confirm dialog is declined', async () => {
  vi.stubGlobal('confirm', () => false)
  let postCalled = false
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options?.method === 'POST') {
      postCalled = true
      return makeFakeResponse(true, 204, {})
    }
    return makeFakeResponse(true, 200, makeSnapshot())
  })
  renderDashboardPage()

  await screen.findByText('Reporter One', { exact: false })
  fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))

  expect(postCalled).toBe(false)
})

test('shows the server detail on a load failure', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 503, { detail: 'Could not load the admin dashboard right now.' }))
  renderDashboardPage()

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Could not load the admin dashboard right now.')
})

test('clears the stale login on a 401', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 401, {}))
  renderDashboardPage()

  await waitFor(() => {
    expect(window.localStorage.getItem('memberId')).toBeNull()
  })
})
