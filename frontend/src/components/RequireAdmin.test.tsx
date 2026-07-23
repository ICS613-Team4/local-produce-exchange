// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import { clearStoredLogin } from '../services/authService'
import RequireAdmin from './RequireAdmin'

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
  return {
    ok: ok,
    status: status,
    text: async () => bodyText,
  }
}

// Renders the guard with one protected child page, so the tests can check
// whether the child, the log-in message, or the forbidden message shows.
function renderGuard() {
  render(
    <MemoryRouter initialEntries={['/admin/members']}>
      <Routes>
        <Route element={<RequireAdmin />}>
          <Route path="/admin/members" element={<p>Protected admin page</p>} />
        </Route>
        <Route path="/login" element={<p>Login page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('blocks a logged-out visitor with a log-in message and link', () => {
  renderGuard()

  expect(screen.queryByText('Protected admin page')).toBeNull()
  expect(screen.getByText(/You must/)).toBeTruthy()
  const loginLink = screen.getByRole('link', { name: 'log in' })
  expect(loginLink.getAttribute('href')).toBe('/login')
})

test('renders the guarded page when the stored id belongs to an admin', async () => {
  window.localStorage.setItem('memberId', 'admin-id')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, { id: 'admin-id', role: 'admin' }))

  renderGuard()

  await waitFor(() => {
    expect(screen.getByText('Protected admin page')).toBeTruthy()
  })
})

test('shows a forbidden message, not the log-in prompt, for a logged-in non-admin', async () => {
  // Scenario 4: a real, logged-in member without admin rights is denied.
  window.localStorage.setItem('memberId', 'member-id')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, { id: 'member-id', role: 'member' }))

  renderGuard()

  await waitFor(() => {
    expect(screen.getByText(/do not have access/)).toBeTruthy()
  })
  expect(screen.queryByText('Protected admin page')).toBeNull()
  expect(screen.queryByRole('link', { name: 'log in' })).toBeNull()
})

test('logs out and blocks when the backend rejects the stored id', async () => {
  window.localStorage.setItem('memberId', 'bad-member-id')
  window.localStorage.setItem('memberName', 'Stale Name')
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 401, { detail: 'Not authenticated.' }))

  renderGuard()

  await waitFor(() => {
    expect(screen.getByRole('link', { name: 'log in' })).toBeTruthy()
  })
  expect(screen.queryByText('Protected admin page')).toBeNull()
  expect(window.localStorage.getItem('memberId')).toBeNull()
  expect(window.localStorage.getItem('memberName')).toBeNull()
})

test('blocks the page when another component clears the login mid-session', async () => {
  window.localStorage.setItem('memberId', 'admin-id')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, { id: 'admin-id', role: 'admin' }))

  renderGuard()

  // The page renders first, because the stored id belongs to an admin.
  expect(await screen.findByText('Protected admin page')).toBeTruthy()

  // Some other page hits a 401 and calls clearStoredLogin. No route change,
  // no reload - just the shared event this guard now listens for.
  clearStoredLogin()

  await waitFor(() => {
    expect(screen.queryByText('Protected admin page')).toBeNull()
  })
  expect(screen.getByText(/You must/)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'log in' })).toBeTruthy()
})
