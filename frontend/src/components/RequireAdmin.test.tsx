// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
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

// Stands in for the real login page. It prints the path the router landed on
// and the "from" target the guard passed along, so a test can read both off
// the screen instead of reaching into router internals.
function LoginProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  let fromValue = ''
  if (location.state !== null && typeof location.state === 'object') {
    const locationState = location.state as { from?: unknown }
    if (typeof locationState.from === 'string') {
      fromValue = locationState.from
    }
  }
  return (
    <div>
      <p>Login page</p>
      <p>path: {location.pathname}</p>
      <p>from: {fromValue}</p>
      <button type="button" onClick={() => navigate(-1)}>Back one entry</button>
    </div>
  )
}

// Clears the login after the guard renders but before its passive effects run.
// This models another tab changing localStorage just before the storage listener
// is installed, so no event reaches that listener.
function ClearLoginBeforePassiveEffects() {
  useLayoutEffect(function clearLogin() {
    window.localStorage.removeItem('memberId')
    window.localStorage.removeItem('memberName')
  }, [])
  return null
}

// Renders the guard with one protected child page, so the tests can check
// whether the child renders, the guard redirected to the login stand-in, or
// the forbidden message shows. The starting entry is a parameter so one test
// can begin at a path that carries a query string.
function renderGuard(
  startingEntry = '/admin/members',
  previousEntry = '',
  clearLoginBeforePassiveEffects = false,
) {
  let initialEntries = [startingEntry]
  if (previousEntry !== '') {
    initialEntries = [previousEntry, startingEntry]
  }

  render(
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialEntries.length - 1}>
      {clearLoginBeforePassiveEffects && <ClearLoginBeforePassiveEffects />}
      <Routes>
        <Route element={<RequireAdmin />}>
          <Route path="/admin/members" element={<p>Protected admin page</p>} />
        </Route>
        <Route path="/login" element={<LoginProbe />} />
        <Route path="/about" element={<p>About page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('redirects a logged-out visitor to the login page', () => {
  renderGuard()

  expect(screen.queryByText('Protected admin page')).toBeNull()
  expect(screen.getByText('Login page')).toBeTruthy()
  expect(screen.getByText('path: /login')).toBeTruthy()
  expect(screen.getByText('from: /admin/members')).toBeTruthy()
})

test('keeps the query string in the return target when it redirects', () => {
  renderGuard('/admin/members?status=suspended')

  expect(screen.getByText('path: /login')).toBeTruthy()
  expect(screen.getByText('from: /admin/members?status=suspended')).toBeTruthy()
})

test('replaces the guarded history entry when it redirects', async () => {
  renderGuard('/admin/members', '/about')

  expect(screen.getByText('path: /login')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Back one entry' }))

  expect(await screen.findByText('About page')).toBeTruthy()
})

test('renders the guarded page when the stored id belongs to an admin', async () => {
  window.localStorage.setItem('memberId', 'admin-id')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, { id: 'admin-id', role: 'admin' }))

  renderGuard()

  await waitFor(() => {
    expect(screen.getByText('Protected admin page')).toBeTruthy()
  })
})

test('reconciles a login cleared before the storage listener is installed', async () => {
  window.localStorage.setItem('memberId', 'admin-id')
  window.localStorage.setItem('memberName', 'Alice Admin')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, {
    id: 'admin-id',
    role: 'admin',
  }))

  renderGuard('/admin/members', '', true)

  expect(await screen.findByText('path: /login')).toBeTruthy()
  expect(screen.getByText('from: /admin/members')).toBeTruthy()
  expect(screen.queryByText('Protected admin page')).toBeNull()
})

test('shows a forbidden message, not a redirect to login, for a logged-in non-admin', async () => {
  // Scenario 4: a real, logged-in member without admin rights is denied. This
  // member stays on the admin path and reads the message; only a logged-out
  // visitor is redirected.
  window.localStorage.setItem('memberId', 'member-id')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, { id: 'member-id', role: 'member' }))

  renderGuard()

  await waitFor(() => {
    expect(screen.getByText(/do not have access/)).toBeTruthy()
  })
  expect(screen.queryByText('Protected admin page')).toBeNull()
  expect(screen.queryByText('Login page')).toBeNull()
})

test('logs out and redirects to login when the backend rejects the stored id', async () => {
  window.localStorage.setItem('memberId', 'bad-member-id')
  window.localStorage.setItem('memberName', 'Stale Name')
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 401, { detail: 'Not authenticated.' }))

  renderGuard()

  await waitFor(() => {
    expect(screen.getByText('path: /login')).toBeTruthy()
  })
  expect(screen.getByText('from: /admin/members')).toBeTruthy()
  expect(screen.queryByText('Protected admin page')).toBeNull()
  expect(window.localStorage.getItem('memberId')).toBeNull()
  expect(window.localStorage.getItem('memberName')).toBeNull()
})

test('redirects to login when another component clears the login mid-session', async () => {
  window.localStorage.setItem('memberId', 'admin-id')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, { id: 'admin-id', role: 'admin' }))

  renderGuard()

  // The page renders first, because the stored id belongs to an admin.
  expect(await screen.findByText('Protected admin page')).toBeTruthy()

  // Some other page hits a 401 and calls clearStoredLogin. No route change,
  // no reload - just the shared event this guard now listens for.
  clearStoredLogin()

  // Wait for the login page itself, not just for the guarded page to go away.
  // Navigate unmounts the guarded page first and changes the URL in the effect
  // right after, so those are two separate renders.
  expect(await screen.findByText('path: /login')).toBeTruthy()
  expect(screen.getByText('from: /admin/members')).toBeTruthy()
  expect(screen.queryByText('Protected admin page')).toBeNull()
})

test('redirects when another browser tab clears the stored login', async () => {
  window.localStorage.setItem('memberId', 'admin-id')
  window.localStorage.setItem('memberName', 'Alice Admin')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, {
    id: 'admin-id',
    role: 'admin',
  }))

  renderGuard()
  expect(await screen.findByText('Protected admin page')).toBeTruthy()

  window.localStorage.removeItem('memberId')
  window.localStorage.removeItem('memberName')
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'memberId',
      oldValue: 'admin-id',
      newValue: null,
      storageArea: window.localStorage,
    }))
  })

  expect(await screen.findByText('path: /login')).toBeTruthy()
  expect(screen.getByText('from: /admin/members')).toBeTruthy()
  expect(screen.queryByText('Protected admin page')).toBeNull()
})

test('hides the old admin page while a changed member id is checked', async () => {
  window.localStorage.setItem('memberId', 'admin-id')

  const requestedUrls: string[] = []
  let finishSecondRequest: (response: FakeResponse) => void = function missingResolver(
    response: FakeResponse,
  ): void {
    throw new Error('Second request resolver was not installed for status ' + response.status + '.')
  }
  const secondRequest = new Promise<FakeResponse>((resolve) => {
    finishSecondRequest = resolve
  })
  vi.stubGlobal('fetch', vi.fn((url: string | URL | Request) => {
    requestedUrls.push(String(url))
    if (requestedUrls.length === 1) {
      return Promise.resolve(makeFakeResponse(true, 200, { id: 'admin-id', role: 'admin' }))
    }
    return secondRequest
  }))

  renderGuard()
  expect(await screen.findByText('Protected admin page')).toBeTruthy()

  window.localStorage.setItem('memberId', 'member-id')
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'memberId',
      oldValue: 'admin-id',
      newValue: 'member-id',
      storageArea: window.localStorage,
    }))
  })

  await waitFor(() => {
    expect(requestedUrls).toHaveLength(2)
  })
  expect(requestedUrls[1]).toBe('/api/members/member-id')
  expect(screen.queryByText('Protected admin page')).toBeNull()
  expect(screen.queryByText(/do not have access/)).toBeNull()

  await act(async () => {
    finishSecondRequest(makeFakeResponse(true, 200, { id: 'member-id', role: 'member' }))
    await secondRequest
  })
  expect(await screen.findByText(/do not have access/)).toBeTruthy()
  expect(screen.queryByText('Protected admin page')).toBeNull()
})
