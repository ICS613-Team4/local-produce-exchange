// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import Layout from './Layout'
import { sendLogoutRequest } from '../services/authService'
import {
  notificationsChangedEventName,
  sendGetUnreadCountRequest,
  unreadCountPollIntervalMilliseconds,
} from '../services/notificationService'
import type { NotificationsResult } from '../services/notificationService'

// Mock the auth service so the Log out button never reaches the network. The
// mock also supplies the shared event name the Layout imports, so the dispatch
// and the listener use the same string the real app uses.
// Only the network call is faked. clearStoredLogin passes through from the
// real module, because clearing the stored login and firing the auth event is
// exactly the behavior this file tests.
vi.mock('../services/authService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/authService')>()
  return {
    authStateChangedEventName: actual.authStateChangedEventName,
    clearStoredLogin: actual.clearStoredLogin,
    sendLogoutRequest: vi.fn(async () => {
      return { ok: true, status: 200, data: '', errorMessage: '' }
    }),
  }
})

// Mock only the polled count request in the notification service; the real
// poll-interval constant passes through so the timer tests advance by the same
// number the header uses. The default answer is a failed tick, which the
// header ignores, so tests that do not care about the bell stay unaffected.
// A bell test queues a real count with mockCountOnce below.
vi.mock('../services/notificationService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/notificationService')>()
  return {
    notificationTimeoutMilliseconds: actual.notificationTimeoutMilliseconds,
    unreadCountPollIntervalMilliseconds: actual.unreadCountPollIntervalMilliseconds,
    notificationsChangedEventName: actual.notificationsChangedEventName,
    sendGetNotificationsRequest: actual.sendGetNotificationsRequest,
    sendGetUnreadCountRequest: vi.fn(async () => {
      return { ok: false, status: 0, data: '', errorMessage: 'not stubbed in this test' }
    }),
  }
})

// Unmount components, clear localStorage, and reset mock call history after every
// test, so one test cannot leak into the next. Real timers and a visible
// document come back too, in case a bell test faked either.
afterEach(() => {
  cleanup()
  window.localStorage.clear()
  vi.clearAllMocks()
  vi.useRealTimers()
  setDocumentHidden(false)
})

// jsdom keeps document.hidden false; the hidden-tab test overrides it.
function setDocumentHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true })
}

// Queue one successful unread-count answer for the bell.
function mockCountOnce(count: number) {
  vi.mocked(sendGetUnreadCountRequest).mockResolvedValueOnce({
    ok: true,
    status: 200,
    data: { unread_count: count },
    errorMessage: '',
  })
}

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
  return render(
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

  expect(screen.getByText('Surplus')).toBeTruthy()
  expect(screen.getAllByRole('link', { name: 'About' }).length).toBeGreaterThanOrEqual(1)
  expect(screen.getAllByRole('link', { name: 'Log in' }).length).toBeGreaterThanOrEqual(1)
  expect(screen.getAllByRole('link', { name: 'Register' }).length).toBeGreaterThanOrEqual(1)

  expect(screen.queryByRole('link', { name: 'Dashboard' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Log out' })).toBeNull()
})

test('shows the logged-in nav when a member is stored', () => {
  window.localStorage.setItem('memberId', 'member-123')
  window.localStorage.setItem('memberName', 'Bob Baker')
  renderLayoutAt('/dashboard')

  expect(screen.getByText('Surplus')).toBeTruthy()
  expect(screen.getAllByRole('link', { name: 'Dashboard' }).length).toBeGreaterThanOrEqual(1)
  expect(screen.getAllByRole('link', { name: 'Incoming Requests' }).length).toBeGreaterThanOrEqual(1)
  expect(screen.getAllByRole('link', { name: 'Log out' }).length).toBeGreaterThanOrEqual(1)

  // There is no Profile nav item; the member's name is the profile link.
  expect(screen.queryByRole('link', { name: 'Profile' })).toBeNull()
  const nameLinks = screen.getAllByRole('link', { name: 'Bob Baker' })
  expect(nameLinks[0].getAttribute('href')).toBe('/profile')

  expect(screen.queryByRole('link', { name: 'Log in' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Register' })).toBeNull()
})

test('the nav link for the current page is highlighted with aria-current', () => {
  window.localStorage.setItem('memberId', 'member-123')
  renderLayoutAt('/dashboard')

  // The Dashboard links (desktop and mobile share the path) carry
  // aria-current="page" and the active background; the other links do not.
  const dashboardLinks = screen.getAllByRole('link', { name: 'Dashboard' })
  for (let index = 0; index < dashboardLinks.length; index = index + 1) {
    expect(dashboardLinks[index].getAttribute('aria-current')).toBe('page')
    expect(dashboardLinks[index].className).toContain('bg-primary-50')
  }
  const browseLinks = screen.getAllByRole('link', { name: 'Browse' })
  expect(browseLinks[0].getAttribute('aria-current')).toBeNull()
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

  fireEvent.click(screen.getAllByRole('link', { name: 'Log out' })[0])

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
  expect(screen.getAllByRole('link', { name: 'Log in' }).length).toBeGreaterThanOrEqual(1)

  // The child writes memberId and navigates, just like a real login.
  fireEvent.click(screen.getByRole('button', { name: 'fake login' }))

  // The route change makes the nav re-read and show the logged-in set.
  expect((await screen.findAllByRole('link', { name: 'Dashboard' })).length).toBeGreaterThanOrEqual(1)
  expect(screen.queryByRole('link', { name: 'Log in' })).toBeNull()
})

test('shows the logged-in member name next to Logout', () => {
  window.localStorage.setItem('memberId', 'member-123')
  window.localStorage.setItem('memberName', 'Bob Baker')
  renderLayoutAt('/dashboard')

  expect(screen.getByText('Bob Baker')).toBeTruthy()
})

test('shows a plain logged-in label when no name is stored', () => {
  window.localStorage.setItem('memberId', 'member-123')
  renderLayoutAt('/dashboard')

  expect(screen.getByText('Logged in')).toBeTruthy()
})

test('re-reads localStorage on the auth event without a route change', async () => {
  // Start logged in on /detail. The nav shows the logged-in set.
  window.localStorage.setItem('memberId', 'member-123')
  renderLayoutAt('/detail')
  expect(screen.getAllByRole('link', { name: 'Log out' }).length).toBeGreaterThanOrEqual(1)

  // The child clears memberId and fires the event, without navigating.
  fireEvent.click(screen.getByRole('button', { name: 'fake stale clear' }))

  // The event makes the nav re-read and show the logged-out set, same route.
  expect((await screen.findAllByRole('link', { name: 'Log in' })).length).toBeGreaterThanOrEqual(1)
  expect(screen.queryByRole('link', { name: 'Log out' })).toBeNull()
})

// ── the notification bell and its badge (US-22) ──────────────────────────────

function setLoggedInMember() {
  window.localStorage.setItem('memberId', 'member-123')
  window.localStorage.setItem('memberName', 'Bob Baker')
}

test('the bell shows the unread count as a badge and says it in the label', async () => {
  setLoggedInMember()
  mockCountOnce(3)
  renderLayoutAt('/dashboard')

  // Queried by role and accessible name, so this proves the screen-reader
  // label carries the count, not just the pixels.
  const bell = await screen.findByRole('link', { name: 'Notifications, 3 unread' })
  expect(bell.getAttribute('href')).toBe('/notifications')
  // The only text inside the bell link is the visible badge number.
  expect(bell.textContent).toBe('3')
})

test('a zero count draws no badge and keeps the plain label', async () => {
  setLoggedInMember()
  mockCountOnce(0)
  renderLayoutAt('/dashboard')
  await act(async () => {})

  expect(sendGetUnreadCountRequest).toHaveBeenCalledTimes(1)
  const bell = screen.getByRole('link', { name: 'Notifications' })
  expect(bell.getAttribute('aria-label')).toBe('Notifications')
  // No badge element renders at zero: a badge showing "0" would be a defect.
  expect(bell.textContent).toBe('')
})

test('a single unread notification says 1 unread in the label', async () => {
  setLoggedInMember()
  mockCountOnce(1)
  renderLayoutAt('/dashboard')

  const bell = await screen.findByRole('link', { name: 'Notifications, 1 unread' })
  expect(bell.textContent).toBe('1')
})

test('a count over nine shows 9+ while the label says the real number', async () => {
  setLoggedInMember()
  mockCountOnce(12)
  renderLayoutAt('/dashboard')

  const bell = await screen.findByRole('link', { name: 'Notifications, 12 unread' })
  expect(bell.textContent).toBe('9+')
})

test('logged out renders no bell and never asks for a count', async () => {
  renderLayoutAt('/')
  await act(async () => {})

  expect(screen.queryByRole('link', { name: /Notifications/ })).toBeNull()
  expect(sendGetUnreadCountRequest).not.toHaveBeenCalled()
})

test('the desktop nav row has no Notifications text link; the bell replaces it', async () => {
  setLoggedInMember()
  mockCountOnce(0)
  renderLayoutAt('/dashboard')
  await act(async () => {})

  // With the mobile menu closed, exactly one link answers to "Notifications",
  // and it is the icon bell (aria-label, svg icon, no visible text), not a
  // sixth text link in the nav row.
  const links = screen.getAllByRole('link', { name: 'Notifications' })
  expect(links.length).toBe(1)
  expect(links[0].getAttribute('aria-label')).toBe('Notifications')
  expect(links[0].querySelector('svg')).toBeTruthy()
  expect(links[0].textContent).toBe('')
})

test('the mobile menu lists a Notifications row with the count spelled out', async () => {
  setLoggedInMember()
  mockCountOnce(2)
  renderLayoutAt('/dashboard')
  await screen.findByRole('link', { name: 'Notifications, 2 unread' })

  fireEvent.click(screen.getByRole('button', { name: 'Toggle navigation menu' }))

  const mobileRow = screen.getByRole('link', { name: 'Notifications (2)' })
  expect(mobileRow.getAttribute('href')).toBe('/notifications')

  // Choosing the row closes the menu, like every other mobile nav row.
  fireEvent.click(mobileRow)
  expect(screen.queryByRole('link', { name: 'Notifications (2)' })).toBeNull()
})

test('a slow answer is never stacked with a second request', async () => {
  vi.useFakeTimers()
  setLoggedInMember()
  // The first ask never answers, so the next tick must skip its request
  // instead of piling a second one on top of the hung backend.
  vi.mocked(sendGetUnreadCountRequest).mockImplementationOnce(() => {
    return new Promise(() => {})
  })
  renderLayoutAt('/dashboard')
  await act(async () => {})
  expect(sendGetUnreadCountRequest).toHaveBeenCalledTimes(1)

  await act(async () => {
    await vi.advanceTimersByTimeAsync(unreadCountPollIntervalMilliseconds)
  })
  expect(sendGetUnreadCountRequest).toHaveBeenCalledTimes(1)
})

test('the badge refreshes on the poll interval without a navigation', async () => {
  vi.useFakeTimers()
  setLoggedInMember()
  mockCountOnce(3)
  mockCountOnce(5)
  renderLayoutAt('/dashboard')

  // The first ask happens on mount, before any tick.
  await act(async () => {})
  expect(sendGetUnreadCountRequest).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('link', { name: 'Notifications, 3 unread' })).toBeTruthy()

  // One poll interval later the count is asked again and the badge moves.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(unreadCountPollIntervalMilliseconds)
  })
  expect(sendGetUnreadCountRequest).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('link', { name: 'Notifications, 5 unread' })).toBeTruthy()
})

test('a hidden tab skips the poll and a visible tab refreshes right away', async () => {
  vi.useFakeTimers()
  setLoggedInMember()
  mockCountOnce(3)
  renderLayoutAt('/dashboard')
  await act(async () => {})
  expect(sendGetUnreadCountRequest).toHaveBeenCalledTimes(1)

  // Hidden: the tick fires but sends nothing.
  setDocumentHidden(true)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(unreadCountPollIntervalMilliseconds)
  })
  expect(sendGetUnreadCountRequest).toHaveBeenCalledTimes(1)

  // Visible again: one request fires immediately, without waiting for a tick.
  mockCountOnce(4)
  setDocumentHidden(false)
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(sendGetUnreadCountRequest).toHaveBeenCalledTimes(2)
})

test('unmounting stops the poll timer', async () => {
  vi.useFakeTimers()
  setLoggedInMember()
  mockCountOnce(3)
  const view = renderLayoutAt('/dashboard')
  await act(async () => {})
  expect(sendGetUnreadCountRequest).toHaveBeenCalledTimes(1)

  // A missing clearInterval would leak a timer per login, so this is asserted
  // rather than trusted: after unmount, no more ticks ask for the count.
  view.unmount()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(unreadCountPollIntervalMilliseconds * 3)
  })
  expect(sendGetUnreadCountRequest).toHaveBeenCalledTimes(1)
})

test('a failed tick keeps the last good count on the badge', async () => {
  vi.useFakeTimers()
  setLoggedInMember()
  mockCountOnce(3)
  // No second answer is queued, so the next tick gets the failing default.
  renderLayoutAt('/dashboard')
  await act(async () => {})
  expect(screen.getByRole('link', { name: 'Notifications, 3 unread' })).toBeTruthy()

  await act(async () => {
    await vi.advanceTimersByTimeAsync(unreadCountPollIntervalMilliseconds)
  })
  expect(sendGetUnreadCountRequest).toHaveBeenCalledTimes(2)
  // The badge does not blank out on one dropped request.
  expect(screen.getByRole('link', { name: 'Notifications, 3 unread' })).toBeTruthy()
})

// ── the badge drops as soon as a notification is marked read (US-23) ─────────

// A count answer the test releases by hand, for holding a request in flight.
function makeHeldCountAnswer() {
  let releaseFn: ((value: NotificationsResult) => void) | null = null
  const promise = new Promise<NotificationsResult>((resolve) => {
    releaseFn = resolve
  })
  function release(count: number) {
    if (releaseFn !== null) {
      releaseFn({ ok: true, status: 200, data: { unread_count: count }, errorMessage: '' })
    }
  }
  return { promise: promise, release: release }
}

test('the notifications-changed event drops the badge right away', async () => {
  setLoggedInMember()
  mockCountOnce(3)
  renderLayoutAt('/dashboard')
  await screen.findByRole('link', { name: 'Notifications, 3 unread' })

  mockCountOnce(2)
  await act(async () => {
    window.dispatchEvent(new Event(notificationsChangedEventName))
  })

  // The rendered result is asserted, not just the service call: the badge
  // number and the accessible name both dropped.
  const bell = screen.getByRole('link', { name: 'Notifications, 2 unread' })
  expect(bell.textContent).toBe('2')
})

test('the event refresh does not wait for the poll timer', async () => {
  vi.useFakeTimers()
  setLoggedInMember()
  mockCountOnce(3)
  renderLayoutAt('/dashboard')
  await act(async () => {})
  expect(sendGetUnreadCountRequest).toHaveBeenCalledTimes(1)

  mockCountOnce(2)
  await act(async () => {
    window.dispatchEvent(new Event(notificationsChangedEventName))
  })

  // The clock never advanced, so this second ask came from the listener, not
  // from the ordinary poll correcting things later.
  expect(sendGetUnreadCountRequest).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('link', { name: 'Notifications, 2 unread' })).toBeTruthy()
})

test('the listener is removed when the header unmounts', async () => {
  setLoggedInMember()
  mockCountOnce(3)
  const view = renderLayoutAt('/dashboard')
  await act(async () => {})
  expect(sendGetUnreadCountRequest).toHaveBeenCalledTimes(1)

  view.unmount()
  await act(async () => {
    window.dispatchEvent(new Event(notificationsChangedEventName))
  })

  // A leftover listener would ask again after unmount.
  expect(sendGetUnreadCountRequest).toHaveBeenCalledTimes(1)
})

test('going from one unread to none removes the badge instead of showing zero', async () => {
  setLoggedInMember()
  mockCountOnce(1)
  renderLayoutAt('/dashboard')
  await screen.findByRole('link', { name: 'Notifications, 1 unread' })

  mockCountOnce(0)
  await act(async () => {
    window.dispatchEvent(new Event(notificationsChangedEventName))
  })

  const bell = screen.getByRole('link', { name: 'Notifications' })
  expect(bell.getAttribute('aria-label')).toBe('Notifications')
  expect(bell.textContent).toBe('')
})

test('an answer that predates the mark is never shown on the badge', async () => {
  vi.useFakeTimers()
  setLoggedInMember()
  mockCountOnce(3)
  renderLayoutAt('/dashboard')
  await act(async () => {})
  expect(screen.getByRole('link', { name: 'Notifications, 3 unread' })).toBeTruthy()

  // Hold a poll in flight. Its eventual answer (4) was computed before the
  // mark, so it must never reach the badge.
  const heldPoll = makeHeldCountAnswer()
  vi.mocked(sendGetUnreadCountRequest).mockImplementationOnce(() => heldPoll.promise)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(unreadCountPollIntervalMilliseconds)
  })
  expect(sendGetUnreadCountRequest).toHaveBeenCalledTimes(2)

  // The mark-read event arrives while that poll is still in flight. No new
  // request can start yet; the re-ask is queued for when the poll lands.
  await act(async () => {
    window.dispatchEvent(new Event(notificationsChangedEventName))
  })
  expect(sendGetUnreadCountRequest).toHaveBeenCalledTimes(2)

  // Hold the re-ask too, so the moment between the two answers is observable.
  const heldReAsk = makeHeldCountAnswer()
  vi.mocked(sendGetUnreadCountRequest).mockImplementationOnce(() => heldReAsk.promise)

  // The stale poll answers 4. The write is skipped and the re-ask fires; with
  // the re-ask still pending, the badge must still say 3, never 4. Asserting
  // only the final number would pass even with the stale write left in, so
  // this intermediate check is the point of the test.
  await act(async () => {
    heldPoll.release(4)
  })
  expect(sendGetUnreadCountRequest).toHaveBeenCalledTimes(3)
  expect(screen.getByRole('link', { name: 'Notifications, 3 unread' })).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Notifications, 4 unread' })).toBeNull()

  // The re-ask answers with the true post-mark count.
  await act(async () => {
    heldReAsk.release(2)
  })
  expect(screen.getByRole('link', { name: 'Notifications, 2 unread' })).toBeTruthy()
})

test('the re-ask after a mid-flight event happens exactly once', async () => {
  vi.useFakeTimers()
  setLoggedInMember()
  mockCountOnce(3)
  renderLayoutAt('/dashboard')
  await act(async () => {})

  const heldPoll = makeHeldCountAnswer()
  vi.mocked(sendGetUnreadCountRequest).mockImplementationOnce(() => heldPoll.promise)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(unreadCountPollIntervalMilliseconds)
  })
  await act(async () => {
    window.dispatchEvent(new Event(notificationsChangedEventName))
  })

  mockCountOnce(2)
  await act(async () => {
    heldPoll.release(3)
  })

  // One initial ask, one held poll, one re-ask: three in total. Letting
  // everything settle adds no fourth call, which proves the flag was cleared
  // before the retry rather than looping.
  expect(sendGetUnreadCountRequest).toHaveBeenCalledTimes(3)
  await act(async () => {})
  await act(async () => {})
  expect(sendGetUnreadCountRequest).toHaveBeenCalledTimes(3)
  expect(screen.getByRole('link', { name: 'Notifications, 2 unread' })).toBeTruthy()
})
