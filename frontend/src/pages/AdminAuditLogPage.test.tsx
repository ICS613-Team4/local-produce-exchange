// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import AdminAuditLogPage from './AdminAuditLogPage'

type FakeResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
  blob?: () => Promise<Blob>
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

function makeFakeResponse(ok: boolean, status: number, body: unknown): FakeResponse {
  return { ok, status, text: async () => JSON.stringify(body) }
}

function renderPage() {
  window.localStorage.setItem('memberId', 'admin-1')
  render(
    <MemoryRouter>
      <AdminAuditLogPage />
    </MemoryRouter>,
  )
}

function clickLoad() {
  fireEvent.click(screen.getByRole('button', { name: 'Load audit log' }))
}

const SAMPLE_LOG = {
  entries: [
    {
      id: 'entry-1',
      admin_id: 'admin-1',
      admin_name: 'Alice Admin',
      action: 'member_suspended',
      target_type: 'member',
      target_id: 'member-2',
      target_label: 'Bob Baker',
      reason: 'Repeated no-shows.',
      created_at: '2026-07-29T00:00:00.000Z',
    },
  ],
  total_count: 1,
  start_date: null,
  end_date: null,
}

test('shows nothing before the first load', () => {
  renderPage()

  expect(screen.queryByRole('table')).toBeNull()
})

test('loads and renders the audit log table', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, SAMPLE_LOG))

  renderPage()
  clickLoad()

  expect(await screen.findByText('Alice Admin')).toBeTruthy()
  expect(screen.getByText('Bob Baker')).toBeTruthy()
  expect(screen.getByText('member suspended')).toBeTruthy()
  expect(screen.getByText('Repeated no-shows.')).toBeTruthy()
})

test('shows an empty-state message when there are no entries', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, { entries: [], total_count: 0, start_date: null, end_date: null }))

  renderPage()
  clickLoad()

  expect(await screen.findByText('No admin actions in this range.')).toBeTruthy()
})

test('shows the server detail on a non-OK response', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 503, { detail: 'Could not load the audit log right now.' }))

  renderPage()
  clickLoad()

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Could not load the audit log right now.')
})

test('clears the stale login on a 401', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 401, {}))

  renderPage()
  clickLoad()

  await waitFor(() => {
    expect(window.localStorage.getItem('memberId')).toBeNull()
  })
})

test('export PDF triggers a download and shows no error on success', async () => {
  const fakeBlob = new Blob(['%PDF-1.4'], { type: 'application/pdf' })
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, blob: async () => fakeBlob }))
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:fake'), revokeObjectURL: vi.fn() })
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

  renderPage()
  fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }))

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Export PDF' }).textContent).toBe('Export PDF')
  })
  expect(anchorClick).toHaveBeenCalledOnce()
  expect(screen.queryByRole('alert')).toBeNull()
})

test('export PDF shows an error message when the export fails', async () => {
  vi.stubGlobal('fetch', async () => ({ ok: false, status: 503 }))

  renderPage()
  fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }))

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('503')
})
