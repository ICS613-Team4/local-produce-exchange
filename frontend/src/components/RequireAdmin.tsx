import { useEffect, useState } from 'react'
import { Link, Outlet } from 'react-router'

import { authStateChangedEventName, clearStoredLogin } from '../services/authService'
import { getMemberProfile } from '../services/memberService'

// Route guard for admin-only pages (US-29), the same shape as RequireAuth but
// with an extra role check on top. Role is not cached in localStorage (only
// memberId/memberName/memberEmail are), so this fetches the viewer's own
// record the same way RequireAuth validates the stored id, and reads .role
// off the response.
//
// A logged-out visitor and a logged-in non-admin see different messages: the
// first genuinely needs to log in, the second is authenticated but not
// authorized, so "log in" would be misleading.
function RequireAdmin() {
  // The stored login, held in state so a logout partway through the session
  // (anywhere in the app, via clearStoredLogin) takes effect without a
  // navigation or a reload. Same pattern RequireAuth follows.
  const [memberId, setMemberId] = useState(window.localStorage.getItem('memberId') ?? '')

  // "checking" - confirming the stored id belongs to an admin
  // "logged_out" - no stored id, or the backend rejected it (401)
  // "forbidden" - a real, logged-in member, but role is not "admin"
  // "ok" - confirmed admin, render the guarded page
  const [authStatus, setAuthStatus] = useState(function pickInitialStatus() {
    if (memberId === '') {
      return 'logged_out'
    }
    return 'checking'
  })

  // Re-read the stored login whenever any code clears it (a 401 anywhere in
  // the app) or sets it (a fresh login). Same listener RequireAuth uses.
  useEffect(function listenForAuthStateChange() {
    function handleAuthStateChange() {
      const storedMemberId = window.localStorage.getItem('memberId') ?? ''
      setMemberId(storedMemberId)
      if (storedMemberId === '') {
        setAuthStatus('logged_out')
      }
    }
    window.addEventListener(authStateChangedEventName, handleAuthStateChange)
    return function removeAuthStateListener() {
      window.removeEventListener(authStateChangedEventName, handleAuthStateChange)
    }
  }, [])

  useEffect(
    function validateAdminAccess() {
      if (memberId === '') {
        return
      }

      let cancelled = false

      async function checkMember() {
        const result = await getMemberProfile(memberId)
        if (cancelled) {
          return
        }

        if (result.status === 401) {
          // The same helper every page calls on a 401, so this guard clears a
          // login the same way RequireAuth does. The event it fires comes
          // back to the listener above, which blocks the page.
          clearStoredLogin()
          return
        }

        if (result.ok && typeof result.data === 'object' && result.data !== null) {
          const role = (result.data as { role?: unknown }).role
          if (role === 'admin') {
            setAuthStatus('ok')
            return
          }
        }

        setAuthStatus('forbidden')
      }

      checkMember()

      return function cancelCheck() {
        cancelled = true
      }
    },
    [memberId],
  )

  if (authStatus === 'checking') {
    return null
  }

  if (authStatus === 'logged_out') {
    return (
      <section>
        <p>
          You must <Link to="/login">log in</Link> to see this page.
        </p>
      </section>
    )
  }

  if (authStatus === 'forbidden') {
    return (
      <section>
        <p>You do not have access to this page.</p>
      </section>
    )
  }

  return <Outlet />
}

export default RequireAdmin
