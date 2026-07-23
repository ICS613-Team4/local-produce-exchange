// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import RequireAuth from './RequireAuth'
import { clearStoredLogin } from '../services/authService'

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

// Renders the guard with one protected child page, so the tests can check
// whether the child or the log-in message shows.
function renderGuard() {
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/dashboard" element={<p>Protected dashboard</p>} />
        </Route>
        <Route path="/login" element={<p>Login page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('blocks a logged-out visitor with a log-in message and link', () => {
  // No memberId stored means nobody is logged in.
  renderGuard()

  expect(screen.queryByText('Protected dashboard')).toBeNull()
  expect(screen.getByText(/You must/)).toBeTruthy()
  const loginLink = screen.getByRole('link', { name: 'log in' })
  expect(loginLink.getAttribute('href')).toBe('/login')
})

test('renders the guarded page when the stored id is valid', async () => {
  window.localStorage.setItem('memberId', 'real-member-id')
  // The backend accepts the id: the profile fetch returns 200.
  const fakeFetch = vi.fn(async () => {
    return makeFakeResponse(true, 200, { id: 'real-member-id' })
  })
  vi.stubGlobal('fetch', fakeFetch)

  renderGuard()

  await waitFor(() => {
    expect(screen.getByText('Protected dashboard')).toBeTruthy()
  })
})

test('logs out and blocks when the backend rejects the stored id', async () => {
  window.localStorage.setItem('memberId', 'bad-member-id')
  window.localStorage.setItem('memberName', 'Stale Name')
  // The backend rejects the id with a 401.
  const fakeFetch = vi.fn(async () => {
    return makeFakeResponse(false, 401, { detail: 'Not authenticated.' })
  })
  vi.stubGlobal('fetch', fakeFetch)

  renderGuard()

  // The guarded page never shows; the log-in message does.
  await waitFor(() => {
    expect(screen.getByRole('link', { name: 'log in' })).toBeTruthy()
  })
  expect(screen.queryByText('Protected dashboard')).toBeNull()
  // The stale login was cleared, so the visitor is really logged out.
  expect(window.localStorage.getItem('memberId')).toBeNull()
  expect(window.localStorage.getItem('memberName')).toBeNull()
})

test('blocks the page when another component clears the login mid-session', async () => {
  window.localStorage.setItem('memberId', 'real-member-id')
  window.localStorage.setItem('memberName', 'Bob Baker')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, { id: 'real-member-id', name: 'Bob Baker' })
  })

  renderGuard()

  // The page renders first, because the stored id is valid.
  expect(await screen.findByText('Protected dashboard')).toBeTruthy()

  // Now a page hits a 401 and calls clearStoredLogin, which clears the stored
  // login and fires this event. There is no route change and no reload.
  clearStoredLogin()

  // The guard notices and takes the page away, showing the one log-in message.
  await waitFor(() => {
    expect(screen.queryByText('Protected dashboard')).toBeNull()
  })
  expect(screen.getByText(/You must/)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'log in' })).toBeTruthy()
})
