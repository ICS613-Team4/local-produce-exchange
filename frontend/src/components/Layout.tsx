import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router'

import { authStateChangedEventName, sendLogoutRequest } from '../services/authService'

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

  useEffect(function listenForAuthStateChange() {
    function handleAuthStateChange() {
      setAuthEventTick(function bumpTick(previousTick) {
        return previousTick + 1
      })
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
