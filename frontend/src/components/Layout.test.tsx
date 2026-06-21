// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import Layout from './Layout'
import { sendLogoutRequest } from '../services/authService'

// Mock the auth service so the Log out button never reaches the network. The
// mock also supplies the shared event name the Layout imports, so the dispatch
// and the listener use the same string the real app uses.
vi.mock('../services/authService', () => {
  return {
    authStateChangedEventName: 'auth-state-changed',
    sendLogoutRequest: vi.fn(async () => {
      return { ok: true, status: 200, data: '', errorMessage: '' }
    }),
  }
})

// Unmount components, clear localStorage, and reset mock call history after every
// test, so one test cannot leak into the next.
afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.clearAllMocks()
})

// A child route that mimics login: it writes memberId and navigates, the same
// shape LoginPage uses. The route-change test uses it to prove the nav re-reads.
function FakeLoginRoute() {
  const navigate = useNavigate()
  function handleClick() {
    window.localStorage.setItem('memberId', 'member-123')
    navigate('/dashboard')
  }
  return <button onClick={handleClick}>fake login</button>
}

// A child route that mimics a stale-session clear: it removes memberId and fires
// the shared event without navigating. The event test uses it to prove the nav
// re-reads without a route change.
function FakeStaleClearRoute() {
  function handleClick() {
    window.localStorage.removeItem('memberId')
    window.dispatchEvent(new Event('auth-state-changed'))
  }
  return <button onClick={handleClick}>fake stale clear</button>
}

// Renders the Layout as a parent route with a few stand-in child routes, the same
// shape App.tsx uses. The starting path decides which child renders first.
function renderLayoutAt(initialPath: string) {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<p>home content</p>} />
          <Route path="/login" element={<FakeLoginRoute />} />
          <Route path="/dashboard" element={<p>dashboard content</p>} />
          <Route path="/detail" element={<FakeStaleClearRoute />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

test('shows the logged-out nav when no member is stored', () => {
  renderLayoutAt('/')

  expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'About' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Test Page' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Log in' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Register' })).toBeTruthy()

  expect(screen.queryByRole('link', { name: 'Dashboard' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Create listing' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Invite a New Member' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'View Profile' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Log out' })).toBeNull()
})

test('shows the logged-in nav when a member is stored', () => {
  window.localStorage.setItem('memberId', 'member-123')
  renderLayoutAt('/dashboard')

  expect(screen.getByRole('link', { name: 'Home' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'About' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Test Page' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Dashboard' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Log out' })).toBeTruthy()

  expect(screen.queryByRole('link', { name: 'Log in' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Register' })).toBeNull()
  // These moved to the Dashboard page, so they are no longer in the nav.
  expect(screen.queryByRole('link', { name: 'Create listing' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Invite a New Member' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'View Profile' })).toBeNull()
})

test('logging out clears credentials, fires the event, and shows the logged-out nav', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  window.localStorage.setItem('memberName', 'Bob Baker')
  window.localStorage.setItem('memberEmail', 'bob@example.com')

  // Listen for the same-tab event the Layout fires on logout.
  let authEventFired = false
  function handleAuthEvent() {
    authEventFired = true
  }
  window.addEventListener('auth-state-changed', handleAuthEvent)

  renderLayoutAt('/dashboard')

  fireEvent.click(screen.getByRole('link', { name: 'Log out' }))

  // The nav flips back to the logged-out set once logout finishes.
  expect(await screen.findByRole('link', { name: 'Log in' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Log out' })).toBeNull()

  expect(sendLogoutRequest).toHaveBeenCalled()
  expect(window.localStorage.getItem('memberId')).toBeNull()
  expect(window.localStorage.getItem('memberName')).toBeNull()
  expect(window.localStorage.getItem('memberEmail')).toBeNull()
  expect(authEventFired).toBe(true)

  window.removeEventListener('auth-state-changed', handleAuthEvent)
})

test('re-reads localStorage on a route change after a child writes memberId', async () => {
  // Start logged out on /login. The nav shows the logged-out set.
  renderLayoutAt('/login')
  expect(screen.getByRole('link', { name: 'Log in' })).toBeTruthy()

  // The child writes memberId and navigates, just like a real login.
  fireEvent.click(screen.getByRole('button', { name: 'fake login' }))

  // The route change makes the nav re-read and show the logged-in set.
  expect(await screen.findByRole('link', { name: 'Dashboard' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Log in' })).toBeNull()
})

test('re-reads localStorage on the auth event without a route change', async () => {
  // Start logged in on /detail. The nav shows the logged-in set.
  window.localStorage.setItem('memberId', 'member-123')
  renderLayoutAt('/detail')
  expect(screen.getByRole('link', { name: 'Log out' })).toBeTruthy()

  // The child clears memberId and fires the event, without navigating.
  fireEvent.click(screen.getByRole('button', { name: 'fake stale clear' }))

  // The event makes the nav re-read and show the logged-out set, same route.
  expect(await screen.findByRole('link', { name: 'Log in' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Log out' })).toBeNull()
})
