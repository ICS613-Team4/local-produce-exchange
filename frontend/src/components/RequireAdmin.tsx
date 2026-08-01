import { startTransition, useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'

import { authStateChangedEventName, clearStoredLogin } from '../services/authService'
import { getMemberProfile } from '../services/memberService'

// Route guard for admin-only pages (US-29), the same shape as RequireAuth but
// with an extra role check on top. Role is not cached in localStorage (only
// memberId/memberName/memberEmail are), so this fetches the viewer's own
// record the same way RequireAuth validates the stored id, and reads .role
// off the response.
//
// A logged-out visitor and a logged-in non-admin are treated differently: the
// first genuinely needs to log in, so this sends them to the log-in form the
// same way RequireAuth does; the second is authenticated but not authorized,
// so they stay on the page and read a message, because "log in" would be
// misleading.
function RequireAdmin() {
  // Where the visitor was trying to go, handed to the login page by the
  // redirect below so logging in returns them to the page they asked for.
  const location = useLocation()

  // The stored login, held in state so a logout partway through the session
  // (anywhere in the app, via clearStoredLogin) takes effect without a
  // navigation or a reload. Same pattern RequireAuth follows.
  const [memberId, setMemberId] = useState(window.localStorage.getItem('memberId') ?? '')

  // "checking" - confirming the stored id belongs to an admin
  // "logged_out" - no stored id, or the backend rejected it (401), redirect
  //   to /login
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
  useEffect(function listenForAuthStateChanges() {
    function handleAuthStateChange() {
      const storedMemberId = window.localStorage.getItem('memberId') ?? ''

      // A different nonempty id means another account replaced the current
      // one. Hide the old account's admin page before checking the new id. This
      // case has no competing route change, so these updates are immediate.
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
          setAuthStatus('logged_out')
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
          // back to the listener above, which redirects to the login page.
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
    // Same redirect RequireAuth performs, with the same path plus query string
    // and the same "replace" so Back skips the guarded entry.
    return (
      <Navigate
        to="/login"
        state={{ from: location.pathname + location.search }}
        replace
      />
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
