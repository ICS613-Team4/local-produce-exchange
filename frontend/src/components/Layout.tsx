import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router'

import { authStateChangedEventName, sendLogoutRequest } from '../services/authService'
import {
  sendGetUnreadCountRequest,
  unreadCountPollIntervalMilliseconds,
} from '../services/notificationService'
import type { UnreadCountResponse } from '../services/notificationService'

function Layout() {
  // Subscribe to the current location. Calling this hook makes the nav
  // re-render on every route change, which re-reads the stored login below (a
  // login writes localStorage and then navigates). The pathname is also read
  // to highlight the nav link of the page the member is on.
  const location = useLocation()

  // A page that clears credentials without changing the route (a stale 401) fires
  // this same-tab event. The listener below bumps this counter, which forces a
  // re-render so the stored login is read again. The counter's value is never
  // used; it exists only to trigger that re-render.
  const [, setAuthEventTick] = useState(0)

  // Mobile menu open/closed state.
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // How many unread notifications the logged-in member has. The header bell
  // shows this as a badge. Zero means no badge is drawn.
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(function listenForAuthStateChange() {
    function handleAuthStateChange() {
      setAuthEventTick(function bumpTick(previousTick) {
        return previousTick + 1
      })
      // A stale-session clear logs the member out without the Log out link, so
      // the bell's count resets here too, not only in handleLogout.
      const storedMemberId = window.localStorage.getItem('memberId') ?? ''
      if (storedMemberId === '') {
        setUnreadCount(0)
      }
    }
    window.addEventListener(authStateChangedEventName, handleAuthStateChange)
    return function removeAuthStateListener() {
      window.removeEventListener(authStateChangedEventName, handleAuthStateChange)
    }
  }, [])

  // Read the stored login during render. A member is logged in when memberId is
  // not empty. memberName is the display name shown next to Logout. Both triggers
  // above (a route change or the auth event) re-render the nav, so this read
  // always reflects the latest localStorage.
  const memberId = window.localStorage.getItem('memberId') ?? ''
  const memberName = window.localStorage.getItem('memberName') ?? ''
  const isLoggedIn = memberId !== ''

  // Keep the bell's unread count fresh. This asks the count-only endpoint right
  // away, then every unreadCountPollIntervalMilliseconds after that. It skips
  // the request while the browser tab is hidden, and asks once immediately when
  // the tab is shown again, so a tab left open in the background sends nothing.
  // location.pathname is deliberately NOT a dependency: the timer plus the
  // visibility refresh already keep the count fresh, and depending on the path
  // would rebuild the timer and fire a request on every navigation.
  useEffect(function pollUnreadCount() {
    // Logged out means no polling at all. The count itself is reset to zero by
    // the logout handler and the auth-event listener (event handlers may set
    // state; an effect body must not), so this effect only ever polls.
    if (isLoggedIn === false) {
      return
    }

    // Set to false by the cleanup below, so a late answer from a logged-out or
    // unmounted header never writes state.
    let stillMounted = true
    // True while a request is in flight. The timer checks this and skips its
    // tick rather than stacking a second request on a slow or hung backend.
    let alreadyAsking = false

    async function loadCount() {
      if (alreadyAsking === true) {
        return
      }
      // Nobody is looking at a hidden tab, so do not spend a request on it.
      if (document.hidden === true) {
        return
      }

      alreadyAsking = true
      const result = await sendGetUnreadCountRequest(memberId)
      alreadyAsking = false

      if (stillMounted === false) {
        return
      }

      if (result.ok === true) {
        const body = result.data as UnreadCountResponse
        setUnreadCount(body.unread_count)
      }
      // A failed tick deliberately does nothing: it leaves the last good count
      // on screen and tries again on the next tick. The header is the wrong
      // place for an error banner, and blanking the badge on one dropped
      // request would make the count flicker.
    }

    // Ask once now, so a member who just logged in does not wait for the first
    // tick to see a badge.
    loadCount()

    const timerId = setInterval(loadCount, unreadCountPollIntervalMilliseconds)

    // When the member comes back to a hidden tab, refresh right away instead of
    // showing a count that could be as old as when they left.
    function handleVisibilityChange() {
      if (document.hidden === false) {
        loadCount()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return function stopPolling() {
      stillMounted = false
      clearInterval(timerId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [isLoggedIn, memberId])

  async function handleLogout() {
    // Clear the stored login right away, so the home page this link navigates to
    // reads the logged-out state. Fire the same event the stale-session pages use,
    // so this nav (and any other listener) re-reads the cleared login. The Link
    // handles going to "/", and we tell the backend after; there is no need to
    // wait for that before leaving.
    window.localStorage.removeItem('memberId')
    window.localStorage.removeItem('memberName')
    window.localStorage.removeItem('memberEmail')
    window.dispatchEvent(new Event(authStateChangedEventName))
    setMobileMenuOpen(false)
    // The next member to log in on this browser must not see this member's
    // badge count while the first fetch is still on its way.
    setUnreadCount(0)
    await sendLogoutRequest()
  }

  function toggleMobileMenu() {
    setMobileMenuOpen(!mobileMenuOpen)
  }

  function closeMobileMenu() {
    setMobileMenuOpen(false)
  }

  // Build the nav links. The link whose path matches the current page gets
  // the highlighted (active) style and aria-current="page", so the member can
  // see which global nav page they are on.
  const navLinkClasses = 'text-sm font-medium text-text hover:text-primary-600 transition-colors duration-150 px-3 py-2 rounded-md hover:bg-primary-50'
  const navLinkActiveClasses = 'text-sm font-semibold text-primary-700 bg-primary-50 transition-colors duration-150 px-3 py-2 rounded-md'
  const mobileNavLinkClasses = 'block text-base font-medium text-text hover:text-primary-600 hover:bg-primary-50 px-4 py-3 rounded-lg transition-colors duration-150'
  const mobileNavLinkActiveClasses = 'block text-base font-semibold text-primary-700 bg-primary-50 px-4 py-3 rounded-lg transition-colors duration-150'

  function isCurrentPage(path: string) {
    return location.pathname === path
  }

  function getNavLinkClasses(path: string) {
    if (isCurrentPage(path)) {
      return navLinkActiveClasses
    }
    return navLinkClasses
  }

  function getMobileNavLinkClasses(path: string) {
    if (isCurrentPage(path)) {
      return mobileNavLinkActiveClasses
    }
    return mobileNavLinkClasses
  }

  function getAriaCurrent(path: string): 'page' | undefined {
    if (isCurrentPage(path)) {
      return 'page'
    }
    return undefined
  }

  // The screen-reader label for the bell. The red circle is color alone, which a
  // screen reader cannot convey, so the count goes in the label as words.
  function getBellLabel() {
    if (unreadCount === 0) {
      return 'Notifications'
    }
    if (unreadCount === 1) {
      return 'Notifications, 1 unread'
    }
    return 'Notifications, ' + unreadCount + ' unread'
  }

  // The mobile row spells the count out in the visible label, so the vertical
  // list needs no badge of its own.
  function getMobileNotificationsLabel() {
    if (unreadCount === 0) {
      return 'Notifications'
    }
    return 'Notifications (' + unreadCount + ')'
  }

  // The number drawn inside the badge. A big count would stretch the circle out
  // of shape, so anything over 9 shows as "9+".
  let badgeText = String(unreadCount)
  if (unreadCount > 9) {
    badgeText = '9+'
  }

  let desktopNavItems
  let mobileNavItems

  if (isLoggedIn) {
    desktopNavItems = (
      <>
        <Link to="/dashboard" className={getNavLinkClasses('/dashboard')} aria-current={getAriaCurrent('/dashboard')} onClick={closeMobileMenu}>Dashboard</Link>
        <Link to="/browse" className={getNavLinkClasses('/browse')} aria-current={getAriaCurrent('/browse')} onClick={closeMobileMenu}>Browse</Link>
        <Link to="/my-listings" className={getNavLinkClasses('/my-listings')} aria-current={getAriaCurrent('/my-listings')} onClick={closeMobileMenu}>My Listings</Link>
        <Link to="/my-requests" className={getNavLinkClasses('/my-requests')} aria-current={getAriaCurrent('/my-requests')} onClick={closeMobileMenu}>My Requests</Link>
        <Link to="/requests" className={getNavLinkClasses('/requests')} aria-current={getAriaCurrent('/requests')} onClick={closeMobileMenu}>Incoming Requests</Link>
      </>
    )
    mobileNavItems = (
      <>
        <Link to="/dashboard" className={getMobileNavLinkClasses('/dashboard')} aria-current={getAriaCurrent('/dashboard')} onClick={closeMobileMenu}>Dashboard</Link>
        <Link to="/notifications" className={getMobileNavLinkClasses('/notifications')} aria-current={getAriaCurrent('/notifications')} onClick={closeMobileMenu}>{getMobileNotificationsLabel()}</Link>
        <Link to="/browse" className={getMobileNavLinkClasses('/browse')} aria-current={getAriaCurrent('/browse')} onClick={closeMobileMenu}>Browse</Link>
        <Link to="/my-listings" className={getMobileNavLinkClasses('/my-listings')} aria-current={getAriaCurrent('/my-listings')} onClick={closeMobileMenu}>My Listings</Link>
        <Link to="/my-requests" className={getMobileNavLinkClasses('/my-requests')} aria-current={getAriaCurrent('/my-requests')} onClick={closeMobileMenu}>My Requests</Link>
        <Link to="/requests" className={getMobileNavLinkClasses('/requests')} aria-current={getAriaCurrent('/requests')} onClick={closeMobileMenu}>Incoming Requests</Link>
        <Link to="/invite" className={getMobileNavLinkClasses('/invite')} aria-current={getAriaCurrent('/invite')} onClick={closeMobileMenu}>Invite</Link>
      </>
    )
  } else {
    desktopNavItems = (
      <>
        <Link to="/browse" className={getNavLinkClasses('/browse')} aria-current={getAriaCurrent('/browse')}>Browse</Link>
        <Link to="/about" className={getNavLinkClasses('/about')} aria-current={getAriaCurrent('/about')}>About</Link>
      </>
    )
    mobileNavItems = (
      <>
        <Link to="/browse" className={getMobileNavLinkClasses('/browse')} aria-current={getAriaCurrent('/browse')} onClick={closeMobileMenu}>Browse</Link>
        <Link to="/about" className={getMobileNavLinkClasses('/about')} aria-current={getAriaCurrent('/about')} onClick={closeMobileMenu}>About</Link>
        <Link to="/login" className={getMobileNavLinkClasses('/login')} aria-current={getAriaCurrent('/login')} onClick={closeMobileMenu}>Log in</Link>
        <Link to="/register" className={getMobileNavLinkClasses('/register')} aria-current={getAriaCurrent('/register')} onClick={closeMobileMenu}>Register</Link>
      </>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* -------- Header / Navbar -------- */}
      <header className="sticky top-0 z-50 border-b border-border bg-surface/80 backdrop-blur-lg">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 no-underline group" onClick={closeMobileMenu}>
              <span className="text-2xl">🌿</span>
              <span className="text-lg font-bold text-text group-hover:text-primary-600 transition-colors">
                Surplus
              </span>
            </Link>

            {/* Desktop nav links */}
            <nav className="hidden md:flex items-center gap-1">
              {desktopNavItems}
            </nav>

            {/* Desktop auth area */}
            <div className="hidden md:flex items-center gap-3">
              {isLoggedIn ? (
                <>
                  {/* The bell replaces a "Notifications" text link in the
                      desktop nav row. The badge circle is aria-hidden because
                      the bell's label already says the count in words; without
                      that a screen reader would announce the number twice. */}
                  <Link
                    to="/notifications"
                    aria-current={getAriaCurrent('/notifications')}
                    aria-label={getBellLabel()}
                    className={
                      isCurrentPage('/notifications')
                        ? 'relative inline-flex items-center p-2 rounded-md text-primary-700 bg-primary-50 transition-colors duration-150'
                        : 'relative inline-flex items-center p-2 rounded-md text-text-muted hover:text-primary-600 hover:bg-primary-50 transition-colors duration-150'
                    }
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                    </svg>
                    {unreadCount > 0 && (
                      <span
                        aria-hidden="true"
                        className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-semibold text-text-inverse"
                      >
                        {badgeText}
                      </span>
                    )}
                  </Link>
                  {/* The member's name doubles as the link to their profile
                      page, replacing a separate Profile nav item. */}
                  <Link
                    to="/profile"
                    aria-current={getAriaCurrent('/profile')}
                    className={
                      isCurrentPage('/profile')
                        ? 'text-xs font-semibold text-primary-700 bg-primary-50 px-3 py-2 rounded-md transition-colors duration-150'
                        : 'text-xs text-text-muted hover:text-primary-600 px-3 py-2 rounded-md hover:bg-primary-50 transition-colors duration-150'
                    }
                  >
                    {memberName || 'Logged in'}
                  </Link>
                  <Link
                    to="/"
                    onClick={handleLogout}
                    className="inline-flex items-center px-4 py-2 text-sm font-medium text-text-muted border border-border rounded-md hover:bg-background-alt hover:text-text transition-all duration-150"
                  >
                    Log out
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    to="/login"
                    className="inline-flex items-center px-4 py-2 text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors"
                  >
                    Log in
                  </Link>
                  <Link
                    to="/register"
                    className="inline-flex items-center px-4 py-2 text-sm font-medium text-text-inverse bg-primary-600 rounded-md hover:bg-primary-700 shadow-sm transition-all duration-150"
                  >
                    Register
                  </Link>
                </>
              )}
            </div>

            {/* Mobile hamburger */}
            <button
              type="button"
              onClick={toggleMobileMenu}
              className="md:hidden inline-flex items-center justify-center p-2 rounded-md text-text-muted hover:text-text hover:bg-background-alt transition-colors"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? (
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile menu panel */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border bg-surface">
            <nav className="px-4 py-3 space-y-1">
              {mobileNavItems}
            </nav>
            <div className="border-t border-border px-4 py-4">
              {isLoggedIn ? (
                <div className="space-y-3">
                  <p className="text-sm text-text-muted px-4">
                    Signed in as{' '}
                    <Link
                      to="/profile"
                      onClick={closeMobileMenu}
                      className="font-medium text-text hover:text-primary-600 transition-colors"
                    >
                      {memberName || 'member'}
                    </Link>
                  </p>
                  <Link
                    to="/"
                    onClick={handleLogout}
                    className="block text-center px-4 py-3 text-sm font-medium text-text-muted border border-border rounded-lg hover:bg-background-alt transition-colors"
                  >
                    Log out
                  </Link>
                </div>
              ) : (
                <div className="space-y-2">
                  <Link
                    to="/login"
                    onClick={closeMobileMenu}
                    className="block text-center px-4 py-3 text-sm font-medium text-primary-600 border border-primary-200 rounded-lg hover:bg-primary-50 transition-colors"
                  >
                    Log in
                  </Link>
                  <Link
                    to="/register"
                    onClick={closeMobileMenu}
                    className="block text-center px-4 py-3 text-sm font-medium text-text-inverse bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
                  >
                    Register
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </header>

      {/* -------- Main content -------- */}
      <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>

      {/* -------- Footer -------- */}
      <footer className="border-t border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-text-muted">
              &copy; 2026 ICS 613 Team 4. Surplus: A Local Produce Exchange.
            </p>
            <div className="flex items-center gap-4 text-sm text-text-muted">
              <Link to="/about" className="hover:text-primary-600 transition-colors">About</Link>
              <Link to="/browse" className="hover:text-primary-600 transition-colors">Browse</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default Layout
