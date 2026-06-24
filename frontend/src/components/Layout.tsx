import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router'

import { authStateChangedEventName, sendLogoutRequest } from '../services/authService'

function Layout() {
  // Subscribe to the current location. We do not read its value; calling this
  // hook is what makes the nav re-render on every route change, and that
  // re-render re-reads the stored login below. A login writes localStorage and
  // then navigates, so without this line the nav would not flip after a login.
  useLocation()

  // A page that clears credentials without changing the route (a stale 401) fires
  // this same-tab event. The listener below bumps this counter, which forces a
  // re-render so the stored login is read again. The counter's value is never
  // used; it exists only to trigger that re-render.
  const [, setAuthEventTick] = useState(0)

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
    await sendLogoutRequest()
  }

  // The label shown next to Logout when signed in: the stored name, or a plain
  // "(Logged in)" when no name is stored.
  let loggedInLabel = '(Logged in)'
  if (memberName !== '') {
    loggedInLabel = '(Logged in as ' + memberName + ')'
  }

  // Build the nav links once into a single variable, so the returned markup stays
  // short. Logged-out visitors only see public pages and the way in; logged-in
  // members see their workflow links and a Logout button.
  let navItems
  if (isLoggedIn) {
    navItems = (
      <>
        <li>
          <Link to="/">Home</Link>
        </li>
        <li>
          <Link to="/about">About</Link>
        </li>
        <li>
          <Link to="/test">Test Page</Link>
        </li>
        <li>
          <Link to="/dashboard">Dashboard</Link>
        </li>
        <li>
          <Link to="/" onClick={handleLogout}>
            Logout
          </Link>{' '}
          {loggedInLabel}
        </li>
      </>
    )
  } else {
    navItems = (
      <>
        <li>
          <Link to="/">Home</Link>
        </li>
        <li>
          <Link to="/about">About</Link>
        </li>
        <li>
          <Link to="/test">Test Page</Link>
        </li>
        <li>
          <Link to="/login">Log in</Link>
        </li>
        <li>
          <Link to="/register">Register</Link>
        </li>
      </>
    )
  }

  return (
    <>
      <header>
        <p>Surplus: A Local Produce Exchange</p>
        <nav>
          <ul>{navItems}</ul>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
      <footer>
        <p>&copy; 2026 ICS 613 Team 4. Surplus: A Local Produce Exchange.</p>
      </footer>
    </>
  )
}

export default Layout
