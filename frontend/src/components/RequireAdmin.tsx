import { useEffect, useState } from 'react'
import { Link, Outlet } from 'react-router'

import { authStateChangedEventName } from '../services/authService'
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
  const memberId = window.localStorage.getItem('memberId') ?? ''

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
          window.localStorage.removeItem('memberId')
          window.localStorage.removeItem('memberName')
          window.localStorage.removeItem('memberEmail')
          window.dispatchEvent(new Event(authStateChangedEventName))
          setAuthStatus('logged_out')
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
