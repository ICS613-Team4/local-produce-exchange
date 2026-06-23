import { useEffect, useState } from 'react'
import { Link, Outlet } from 'react-router'

import { authStateChangedEventName } from '../services/authService'
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
function RequireAuth() {
  // Read the stored login once during render. Empty means nobody is logged in.
  const memberId = window.localStorage.getItem('memberId') ?? ''

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
          window.localStorage.removeItem('memberId')
          window.localStorage.removeItem('memberName')
          window.localStorage.removeItem('memberEmail')
          window.dispatchEvent(new Event(authStateChangedEventName))
          setAuthStatus('blocked')
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
