import { useEffect, useState } from 'react'
import { Link, Outlet } from 'react-router'

import { authStateChangedEventName, clearStoredLogin } from '../services/authService'
import { getMemberProfile } from '../services/memberService'

// Route guard for member-only pages. It wraps a group of routes in App.tsx, so
// every page inside it is protected by this one component instead of each page
// repeating the same check.
//
// There is no server session yet. "Logged in" means localStorage holds a
// memberId, and every API call sends that id as the X-Member-Id header. So the
// guard does two things:
//   1. No stored memberId -> nobody is logged in, show the log-in message.
//   2. A stored memberId the backend rejects (HTTP 401) -> the id is not a real
//      member, so log out (clear the stored login) and show the same message.
// Anything else lets the guarded page render.
// This guard is the ONLY place that decides whether a member is logged in, and
// the only place that renders the log-in message. Pages behind it never check
// again: they read the stored id for the X-Member-Id header and, on a 401, call
// clearStoredLogin() and return. That dispatches the auth event this component
// listens for, so the guard blocks the page and the nav flips to its
// logged-out links at the same moment.
function RequireAuth() {
  // The stored login, held in state so a logout partway through the session
  // takes effect without a navigation or a reload. Empty means nobody is
  // logged in.
  const [memberId, setMemberId] = useState(window.localStorage.getItem('memberId') ?? '')

  // The guard's state, as a plain string:
  //   "checking" - still asking the backend whether the stored id is valid
  //   "ok"       - the id is valid, render the guarded page
  //   "blocked"  - no id, or the backend rejected it, show the log-in message
  // Start at "blocked" when there is no id so a logged-out visitor never sees a
  // "checking" flash before the message.
  const [authStatus, setAuthStatus] = useState(function pickInitialStatus() {
    if (memberId === '') {
      return 'blocked'
    }
    return 'checking'
  })

  // Re-read the stored login whenever any code clears it (a 401 anywhere in
  // the app) or sets it (a fresh login). Same shape as the listener in
  // Layout.tsx, which flips the nav on the same event.
  useEffect(function listenForAuthStateChange() {
    function handleAuthStateChange() {
      const storedMemberId = window.localStorage.getItem('memberId') ?? ''
      setMemberId(storedMemberId)
      if (storedMemberId === '') {
        // Block right away rather than waiting for the validation effect,
        // so the page never lingers after the login is gone.
        setAuthStatus('blocked')
      }
    }
    window.addEventListener(authStateChangedEventName, handleAuthStateChange)
    return function removeAuthStateListener() {
      window.removeEventListener(authStateChangedEventName, handleAuthStateChange)
    }
  }, [])

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
        // show the message.
        if (result.status === 401) {
          // The same helper every page calls on a 401, so the guard and the
          // pages clear a login the same way. The event it fires comes back
          // to the listener above, which blocks the page.
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
    return (
      <section>
        <p>
          You must <Link to="/login">log in</Link> to see this page.
        </p>
      </section>
    )
  }

  // authStatus is "ok": render whichever guarded page matched the route.
  return <Outlet />
}

export default RequireAuth
