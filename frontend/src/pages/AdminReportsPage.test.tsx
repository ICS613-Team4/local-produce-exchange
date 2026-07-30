// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import AdminReportsPage from './AdminReportsPage'

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
  const bodyText = JSON.stringify(body)
  return { ok, status, text: async () => bodyText }
}

function renderReportsPage() {
  window.localStorage.setItem('memberId', 'admin-1')
  render(
    <MemoryRouter>
      <AdminReportsPage />
    </MemoryRouter>,
  )
}

function clickGenerate() {
  fireEvent.click(screen.getByRole('button', { name: 'Generate report' }))
}

const SAMPLE_REPORT = {
  start_date: null,
  end_date: null,
  generated_at: '2026-07-25T00:00:00+00:00',
  listings_by_status: { active: 3, claimed: 1, expired: 0, cancelled: 0, deactivated: 1 },
  total_listings: 5,
  requests_by_status: { requested: 2, approved: 1, picked_up: 0, completed: 4, cancelled: 0, denied: 1 },
  total_requests: 8,
  completed_exchanges: 4,
  members_by_status: { active: 6, suspended: 1, inactive: 0 },
  total_members: 7,
  members_suspended: 2,
  members_reinstated: 1,
}

test('shows nothing before a report has been generated', () => {
  renderReportsPage()

  expect(screen.queryByText('Listings')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

test('shows the breakdown cards with totals and per-status counts', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, SAMPLE_REPORT))

  renderReportsPage()
  clickGenerate()

  expect(await screen.findByText('Listings')).toBeTruthy()
  expect(screen.getByText('Requests')).toBeTruthy()
  expect(screen.getByText('Members')).toBeTruthy()
  expect(screen.getByText('Completed exchanges')).toBeTruthy()
  // Totals.
  expect(screen.getByText('5')).toBeTruthy()
  expect(screen.getByText('8')).toBeTruthy()
  expect(screen.getByText('7')).toBeTruthy()
  expect(screen.getAllByText('4').length).toBeGreaterThan(0)
})

test('shows suspension activity counts alongside the member status breakdown', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, SAMPLE_REPORT))

  renderReportsPage()
  clickGenerate()

  const suspendedLabel = await screen.findByText('Suspended in this period')
  expect(suspendedLabel.parentElement?.textContent).toBe('Suspended in this period2')

  const reinstatedLabel = screen.getByText('Reinstated in this period')
  expect(reinstatedLabel.parentElement?.textContent).toBe('Reinstated in this period1')
})

test('shows an all-time note when no date range was set', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, SAMPLE_REPORT))

  renderReportsPage()
  clickGenerate()

  expect(await screen.findByText('Covers all activity, with no date range set.')).toBeTruthy()
})

test('shows an "onward" note when only a start date was set', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, { ...SAMPLE_REPORT, start_date: '2026-06-01' }))

  renderReportsPage()
  clickGenerate()

  expect(await screen.findByText('Covers 2026-06-01 onward.')).toBeTruthy()
})

test('shows a "through" note when only an end date was set', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, { ...SAMPLE_REPORT, end_date: '2026-06-30' }))

  renderReportsPage()
  clickGenerate()

  expect(await screen.findByText('Covers everything through 2026-06-30.')).toBeTruthy()
})

test('sends the typed start and end dates as query params', async () => {
  let requestUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    requestUrl = String(url)
    return makeFakeResponse(true, 200, { ...SAMPLE_REPORT, start_date: '2026-06-01', end_date: '2026-06-30' })
  })

  renderReportsPage()
  fireEvent.change(screen.getByLabelText('Start date (optional)'), { target: { value: '2026-06-01' } })
  fireEvent.change(screen.getByLabelText('End date (optional)'), { target: { value: '2026-06-30' } })
  clickGenerate()

  await screen.findByText('Listings')
  expect(requestUrl).toBe('/api/admin/reports?start_date=2026-06-01&end_date=2026-06-30')
  expect(screen.getByText('Covers 2026-06-01 through 2026-06-30.')).toBeTruthy()
})

test('shows the backend error message when the date range is invalid', async () => {
  vi.stubGlobal('fetch', async () =>
    makeFakeResponse(false, 422, { detail: 'start_date must not be after end_date.' }),
  )

  renderReportsPage()
  clickGenerate()

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toContain('start_date must not be after end_date.')
})

test('shows a generic error message when the failure body has no usable detail', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 503, 'Internal Server Error'))

  renderReportsPage()
  clickGenerate()

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toContain('Could not generate the report (HTTP 503).')
})

test('shows an error message on a network failure (transport error, not an HTTP status)', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('Network unreachable')
  })

  renderReportsPage()
  clickGenerate()

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toContain('Request failed')
})

test('clears the stale login on a 401 instead of showing a generic error', async () => {
  window.localStorage.setItem('memberName', 'Stale Name')
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 401, { detail: 'Not authenticated.' }))

  renderReportsPage()
  clickGenerate()

  await waitFor(() => {
    expect(window.localStorage.getItem('memberId')).toBeNull()
  })
  expect(window.localStorage.getItem('memberName')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

test('links to the admin audit log', () => {
  renderReportsPage()

  const link = screen.getByRole('link', { name: 'View admin audit log →' })
  expect(link.getAttribute('href')).toBe('/admin/audit-log')
})
