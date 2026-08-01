import { startTransition, useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'

import { authStateChangedEventName, clearStoredLogin } from '../services/authService'
import { getMemberProfile } from '../services/memberService'

// Route guard for member-only pages. It wraps a group of routes in App.tsx, so
// every page inside it is protected by this one component instead of each page
// repeating the same check.
//
// There is no server session yet. "Logged in" means localStorage holds a
// memberId, and every API call sends that id as the X-Member-Id header. So the
// guard does two things:
//   1. No stored memberId -> nobody is logged in, send them to /login.
//   2. A stored memberId the backend rejects (HTTP 401) -> the id is not a real
//      member, so log out (clear the stored login) and send them to /login too.
// Anything else lets the guarded page render.
// This shared guard decides whether a member route can render and redirects a
// logged-out visitor. Pages behind it never check again: they read the stored
// id for the X-Member-Id header and, on a 401, call clearStoredLogin() and
// return. That dispatches the auth event this component listens for, so the
// guard takes the page away and the nav flips to its logged-out links at the
// same moment. RequireAdmin applies the same login check to admin routes.
function RequireAuth() {
  // Where the visitor was trying to go. The redirect below hands this to the
  // login page, so logging in returns them to the page they asked for.
  const location = useLocation()

  // The stored login, held in state so a logout partway through the session
  // takes effect without a navigation or a reload. Empty means nobody is
  // logged in.
  const [memberId, setMemberId] = useState(window.localStorage.getItem('memberId') ?? '')

  // The guard's state, as a plain string:
  //   "checking" - still asking the backend whether the stored id is valid
  //   "ok"       - the id is valid, render the guarded page
  //   "blocked"  - no id, or the backend rejected it, redirect to /login
  // Start at "blocked" when there is no id so a logged-out visitor never sees a
  // "checking" flash before the redirect.
  const [authStatus, setAuthStatus] = useState(function pickInitialStatus() {
    if (memberId === '') {
      return 'blocked'
    }
    return 'checking'
  })

  // Re-read the stored login whenever any code clears it (a 401 anywhere in
  // the app) or sets it (a fresh login). Same shape as the listener in
  // Layout.tsx, which flips the nav on the same event.
  useEffect(function listenForAuthStateChanges() {
    function handleAuthStateChange() {
      const storedMemberId = window.localStorage.getItem('memberId') ?? ''

      // A different nonempty id means another account replaced the current
      // one. Hide the old account's page before checking the new id. This case
      // has no competing route change, so these updates do not need deferral.
      if (storedMemberId !== '' && storedMemberId !== memberId) {
        setMemberId(storedMemberId)
        setAuthStatus('checking')
        return
      }

      // startTransition defers these updates, matching React's route update.
      // Log out clears the login and navigates to "/" in one click; without
      // this the guard would block first, redirect to /login, and beat the
      // navigation the same click asked for.
      startTransition(function applyAuthChange() {
        setMemberId(storedMemberId)
        if (storedMemberId === '') {
          // Block right away rather than waiting for the validation effect,
          // so the page never lingers after the login is gone.
          setAuthStatus('blocked')
        }
      })
    }

    function handleStorageChange(event: StorageEvent) {
      // localStorage is shared between tabs. When another tab changes or
      // clears memberId, re-read it through the same deferred update above.
      if (event.storageArea !== window.localStorage) {
        return
      }
      if (event.key !== null && event.key !== 'memberId') {
        return
      }
      handleAuthStateChange()
    }

    window.addEventListener(authStateChangedEventName, handleAuthStateChange)
    window.addEventListener('storage', handleStorageChange)

    // Re-read after subscribing. This catches a storage change that happened
    // after render read the old id but before these listeners were installed.
    handleAuthStateChange()

    return function removeAuthStateListeners() {
      window.removeEventListener(authStateChangedEventName, handleAuthStateChange)
      window.removeEventListener('storage', handleStorageChange)
    }
  }, [memberId])

  useEffect(
    function validateStoredLogin() {
      // No id means there is nothing to validate. The initial state is already
      // "blocked", so just stop here without calling the backend.
      if (memberId === '') {
        return
      }

      // If the member navigates away mid-check, this flag stops the late answer
      // from updating state on an unmounted guard.
      let cancelled = false

      async function checkMember() {
        const result = await getMemberProfile(memberId)
        if (cancelled) {
          return
        }
        // A 401 is the backend saying the X-Member-Id is missing, malformed, or
        // unknown. Treat that as "not logged in": clear the stored login, tell
        // the shared nav to re-read it so it flips to the logged-out links, and
        // redirect to /login.
        if (result.status === 401) {
          // The same helper every page calls on a 401, so the guard and the
          // pages clear a login the same way. The event it fires comes back
          // to the listener above, which redirects to the login page.
          clearStoredLogin()
          return
        }
        // Any other answer, including a transient network error, lets the page
        // render. A real problem on that page will surface through its own API
        // call. ponytail: re-validates on every protected navigation; cache the
        // result in a context if these checks get chatty.
        setAuthStatus('ok')
      }

      checkMember()

      return function cancelCheck() {
        cancelled = true
      }
    },
    [memberId],
  )

  if (authStatus === 'checking') {
    // Render nothing while the backend confirms the stored id. This is a quick
    // round trip, so a logged-in member sees the page appear with no flash of
    // placeholder text.
    return null
  }

  if (authStatus === 'blocked') {
    // Send the visitor to the log-in form and remember where they were headed,
    // as a plain path plus query string because that is all the login page
    // needs. "replace" swaps this guarded entry for /login instead of adding
    // one, so pressing Back goes to the page before it, not back into the
    // guard and straight to /login again.
    return (
      <Navigate
        to="/login"
        state={{ from: location.pathname + location.search }}
        replace
      />
    )
  }

  // authStatus is "ok": render whichever guarded page matched the route.
  return <Outlet />
}

export default RequireAuth
