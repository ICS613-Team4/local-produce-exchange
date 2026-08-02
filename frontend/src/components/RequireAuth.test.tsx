// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
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
// whether the child renders or the guard redirected to the login stand-in.
// The starting entry is a parameter so one test can begin at a path that
// carries a query string.
function renderGuard(
  startingEntry = '/dashboard',
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
        <Route element={<RequireAuth />}>
          <Route path="/dashboard" element={<p>Protected dashboard</p>} />
        </Route>
        <Route path="/login" element={<LoginProbe />} />
        <Route path="/about" element={<p>About page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('redirects a logged-out visitor to the login page', () => {
  // No memberId stored means nobody is logged in.
  renderGuard()

  expect(screen.queryByText('Protected dashboard')).toBeNull()
  expect(screen.getByText('Login page')).toBeTruthy()
  expect(screen.getByText('path: /login')).toBeTruthy()
  expect(screen.getByText('from: /dashboard')).toBeTruthy()
})

test('keeps the query string in the return target when it redirects', () => {
  renderGuard('/dashboard?tab=open')

  expect(screen.getByText('path: /login')).toBeTruthy()
  expect(screen.getByText('from: /dashboard?tab=open')).toBeTruthy()
})

test('replaces the guarded history entry when it redirects', async () => {
  renderGuard('/dashboard', '/about')

  expect(screen.getByText('path: /login')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Back one entry' }))

  expect(await screen.findByText('About page')).toBeTruthy()
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

test('reconciles a login cleared before the storage listener is installed', async () => {
  window.localStorage.setItem('memberId', 'real-member-id')
  window.localStorage.setItem('memberName', 'Bob Baker')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, { id: 'real-member-id', name: 'Bob Baker' })
  })

  renderGuard('/dashboard', '', true)

  expect(await screen.findByText('path: /login')).toBeTruthy()
  expect(screen.getByText('from: /dashboard')).toBeTruthy()
  expect(screen.queryByText('Protected dashboard')).toBeNull()
})

test('logs out and redirects when the backend rejects the stored id', async () => {
  window.localStorage.setItem('memberId', 'bad-member-id')
  window.localStorage.setItem('memberName', 'Stale Name')
  // The backend rejects the id with a 401.
  const fakeFetch = vi.fn(async () => {
    return makeFakeResponse(false, 401, { detail: 'Not authenticated.' })
  })
  vi.stubGlobal('fetch', fakeFetch)

  renderGuard()

  // The guarded page never shows; the browser ends up on the login page.
  await waitFor(() => {
    expect(screen.getByText('path: /login')).toBeTruthy()
  })
  expect(screen.getByText('from: /dashboard')).toBeTruthy()
  expect(screen.queryByText('Protected dashboard')).toBeNull()
  // The stale login was cleared, so the visitor is really logged out.
  expect(window.localStorage.getItem('memberId')).toBeNull()
  expect(window.localStorage.getItem('memberName')).toBeNull()
})

test('redirects to login when another component clears the login mid-session', async () => {
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

  // The guard notices and takes the page away, sending the member to /login.
  // Wait for the login page itself, not just for the guarded page to go away:
  // Navigate unmounts the guarded page first and changes the URL in the effect
  // right after, so those are two separate renders.
  expect(await screen.findByText('path: /login')).toBeTruthy()
  expect(screen.getByText('from: /dashboard')).toBeTruthy()
  expect(screen.queryByText('Protected dashboard')).toBeNull()
})

test('redirects when another browser tab clears the stored login', async () => {
  window.localStorage.setItem('memberId', 'real-member-id')
  window.localStorage.setItem('memberName', 'Bob Baker')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, { id: 'real-member-id', name: 'Bob Baker' })
  })

  renderGuard()
  expect(await screen.findByText('Protected dashboard')).toBeTruthy()

  // Another tab changes shared localStorage. Browsers notify this tab with a
  // storage event rather than the custom same-tab auth event.
  window.localStorage.removeItem('memberId')
  window.localStorage.removeItem('memberName')
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'memberId',
      oldValue: 'real-member-id',
      newValue: null,
      storageArea: window.localStorage,
    }))
  })

  expect(await screen.findByText('path: /login')).toBeTruthy()
  expect(screen.getByText('from: /dashboard')).toBeTruthy()
  expect(screen.queryByText('Protected dashboard')).toBeNull()
})

test('hides the old account page while a changed member id is checked', async () => {
  window.localStorage.setItem('memberId', 'first-member-id')

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
      return Promise.resolve(makeFakeResponse(true, 200, { id: 'first-member-id' }))
    }
    return secondRequest
  }))

  renderGuard()
  expect(await screen.findByText('Protected dashboard')).toBeTruthy()

  window.localStorage.setItem('memberId', 'second-member-id')
  act(() => {
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'memberId',
      oldValue: 'first-member-id',
      newValue: 'second-member-id',
      storageArea: window.localStorage,
    }))
  })

  await waitFor(() => {
    expect(requestedUrls).toHaveLength(2)
  })
  expect(requestedUrls[1]).toBe('/api/members/second-member-id')
  expect(screen.queryByText('Protected dashboard')).toBeNull()
  expect(screen.queryByText('Login page')).toBeNull()

  await act(async () => {
    finishSecondRequest(makeFakeResponse(true, 200, { id: 'second-member-id' }))
    await secondRequest
  })
  expect(await screen.findByText('Protected dashboard')).toBeTruthy()
})
