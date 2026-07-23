// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import AdminMemberDetailPage from './AdminMemberDetailPage'

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

function renderDetailPage(targetMemberId: string) {
  window.localStorage.setItem('memberId', 'admin-1')
  render(
    <MemoryRouter initialEntries={['/admin/members/' + targetMemberId]}>
      <Routes>
        <Route path="/admin/members/:id" element={<AdminMemberDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const REGULAR_MEMBER = {
  id: 'member-2',
  name: 'Carol Chen',
  email: 'carol@example.com',
  status: 'active',
  role: 'member',
  created_at: '2026-01-15T00:00:00+00:00',
  suspended_at: null,
  display_name: 'Carol',
  neighborhood: 'Kailua',
  contact_preference: 'either',
}

test('shows a loading state before the fetch resolves', () => {
  vi.stubGlobal('fetch', () => new Promise(() => {}))

  renderDetailPage('member-2')

  expect(screen.getByText(/Loading/)).toBeTruthy()
})

test('shows full account details for a regular member', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, REGULAR_MEMBER))

  renderDetailPage('member-2')

  expect(await screen.findByRole('heading', { name: 'Carol Chen' })).toBeTruthy()
  expect(screen.getByText('carol@example.com')).toBeTruthy()
  expect(screen.getByText('member')).toBeTruthy()
  expect(screen.getByText('active')).toBeTruthy()
  expect(screen.getByText('Carol')).toBeTruthy()
  expect(screen.getByText('Kailua')).toBeTruthy()
  expect(screen.getByText('either')).toBeTruthy()
})

test('shows a disabled Suspend control for an active, non-admin member', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, REGULAR_MEMBER))

  renderDetailPage('member-2')

  const suspendButton = await screen.findByRole('button', { name: 'Suspend account' })
  expect(suspendButton.hasAttribute('disabled')).toBe(true)
})

test('shows a disabled Reinstate control and a suspended-since row for a suspended member', async () => {
  const suspendedMember = {
    ...REGULAR_MEMBER,
    status: 'suspended',
    suspended_at: '2026-05-01T00:00:00+00:00',
  }
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, suspendedMember))

  renderDetailPage('member-2')

  const reinstateButton = await screen.findByRole('button', { name: 'Reinstate account' })
  expect(reinstateButton.hasAttribute('disabled')).toBe(true)
  expect(screen.getByText('Suspended since')).toBeTruthy()
})

test('hides the suspend/reinstate control entirely when the target is also an admin', async () => {
  const adminTarget = { ...REGULAR_MEMBER, role: 'admin' }
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, adminTarget))

  renderDetailPage('member-2')

  await screen.findByRole('heading', { name: 'Carol Chen' })
  expect(screen.queryByRole('button', { name: 'Suspend account' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Reinstate account' })).toBeNull()
})

test('shows an error message when the member is not found', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 404, { detail: 'Member not found.' }))

  renderDetailPage('missing-id')

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toContain('Member not found.')
})

test('shows an error message on a network failure (transport error, not an HTTP status)', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('Network unreachable')
  })

  renderDetailPage('member-2')

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toContain('Request failed')
})

test('shows the neutral fallback badge for an inactive member', async () => {
  const inactiveMember = { ...REGULAR_MEMBER, status: 'inactive' }
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, inactiveMember))

  renderDetailPage('member-2')

  expect(await screen.findByText('inactive')).toBeTruthy()
})

test('has a back link to the search page', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, REGULAR_MEMBER))

  renderDetailPage('member-2')

  const backLink = await screen.findByRole('link', { name: /Back to search/ })
  expect(backLink.getAttribute('href')).toBe('/admin/members')
})

test('clears the stale login on a 401 instead of showing a generic error', async () => {
  window.localStorage.setItem('memberName', 'Stale Name')
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 401, { detail: 'Not authenticated.' }))

  renderDetailPage('member-2')

  await waitFor(() => {
    expect(window.localStorage.getItem('memberId')).toBeNull()
  })
  expect(window.localStorage.getItem('memberName')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})
