import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import { clearStoredLogin } from '../services/authService'
import {
  getAdminMemberDetail,
  suspendMember,
  unsuspendMember,
  type AdminMemberDetail,
  type AdminMemberResult,
} from '../services/adminMemberService'
import { formatTimestamp } from '../utils/formatTimestamp'

// Same status badge color pairing as AdminMemberSearchPage. Not shared
// between the two on purpose: MyListingsPage and MyRequestsPage each keep
// their own local status-badge helper too, rather than a shared one.
function getStatusBadgeClasses(status: string): string {
  if (status === 'active') return 'bg-success-bg text-success'
  if (status === 'suspended') return 'bg-error-bg text-error'
  return 'bg-background-alt text-text-muted'
}

function AdminMemberDetailPage() {
  const memberId = window.localStorage.getItem('memberId') ?? ''
  const params = useParams()
  const targetMemberId = params.id ?? ''

  const [result, setResult] = useState<AdminMemberResult | null>(null)
  // The id `result` was fetched for, so a stale result from a previous :id
  // (navigating from one member's detail page straight to another's) is not
  // shown while the new fetch is still in flight. Same pattern as
  // ListingDetailPage's resultListingId, which avoids resetting result to
  // null synchronously inside the effect.
  const [resultForId, setResultForId] = useState('')

  // US-25/US-26: the optional reason typed before suspending, whether the
  // suspend/reinstate call is in flight (disables the button so a double
  // click cannot fire it twice), and the error line from a failed action.
  const [reasonText, setReasonText] = useState('')
  const [actionPending, setActionPending] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    if (memberId === '' || targetMemberId === '') {
      return
    }
    getAdminMemberDetail(targetMemberId, memberId).then((loadedResult) => {
      if (loadedResult.status === 401) {
        // Same convention every protected page follows: clear the stale
        // login and let RequireAdmin's listener take the page away.
        clearStoredLogin()
        return
      }
      setResult(loadedResult)
      setResultForId(targetMemberId)
    })
  }, [memberId, targetMemberId])

  const isCurrent = result !== null && resultForId === targetMemberId

  // Shared by handleSuspend and handleUnsuspend: send the action, and either
  // show the member's new state (the endpoint returns the updated detail
  // directly, so there is no need to re-fetch) or show why it failed.
  async function runAction(actionResult: Promise<AdminMemberResult>) {
    setActionPending(true)
    setActionError('')
    const loadedResult = await actionResult
    setActionPending(false)

    if (loadedResult.status === 401) {
      clearStoredLogin()
      return
    }
    if (loadedResult.ok) {
      setResult(loadedResult)
      setReasonText('')
      return
    }

    let detail: unknown = undefined
    if (typeof loadedResult.data === 'object' && loadedResult.data !== null) {
      detail = (loadedResult.data as { detail?: unknown }).detail
    }
    let detailMessage = 'Could not update this account (HTTP ' + loadedResult.status + ').'
    if (typeof detail === 'string') {
      detailMessage = detail
    }
    setActionError(detailMessage)
  }

  function handleSuspend() {
    if (!window.confirm('Suspend this account? They will no longer be able to log in or take member actions.')) {
      return
    }
    runAction(suspendMember(targetMemberId, memberId, reasonText))
  }

  function handleUnsuspend() {
    if (!window.confirm('Reinstate this account? They will be able to log in and take member actions again.')) {
      return
    }
    runAction(unsuspendMember(targetMemberId, memberId))
  }

  const backLink = (
    <Link to="/admin/members" className="text-sm font-medium text-primary-600 hover:text-primary-700">
      &larr; Back to search
    </Link>
  )

  if (!isCurrent || result === null) {
    return (
      <section>
        {backLink}
        <p className="text-text-muted text-sm py-8 text-center">Loading&hellip;</p>
      </section>
    )
  }

  if (result.errorMessage !== '') {
    return (
      <section>
        {backLink}
        <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error mt-4" role="alert">
          {result.errorMessage}
        </div>
      </section>
    )
  }

  if (!result.ok) {
    let detail: unknown = undefined
    if (typeof result.data === 'object' && result.data !== null) {
      detail = (result.data as { detail?: unknown }).detail
    }
    let detailMessage = 'Could not load this member (HTTP ' + result.status + ').'
    if (typeof detail === 'string') {
      detailMessage = detail
    }
    return (
      <section>
        {backLink}
        <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error mt-4" role="alert">
          {detailMessage}
        </div>
      </section>
    )
  }

  const member = result.data as AdminMemberDetail

  // US-29, admin-viewing-admin: full detail is fine (transparency), but no
  // suspend/reinstate control, since there is no admin hierarchy in this
  // schema to arbitrate one admin acting on another - the same role check
  // also stops an admin from suspending themselves.
  const actionErrorLine =
    actionError !== '' ? (
      <p className="text-sm text-error mt-2" role="alert">
        {actionError}
      </p>
    ) : null

  let suspendControl = null
  if (member.role !== 'admin') {
    if (member.status === 'suspended') {
      suspendControl = (
        <div className="mt-6">
          <button
            type="button"
            disabled={actionPending}
            onClick={handleUnsuspend}
            className="inline-flex items-center px-6 py-2.5 text-sm font-semibold text-text-inverse bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {actionPending ? 'Reinstating…' : 'Reinstate account'}
          </button>
          {actionErrorLine}
        </div>
      )
    } else {
      suspendControl = (
        <div className="mt-6">
          <label htmlFor="suspend-reason" className="block text-sm font-medium text-text mb-1.5">
            Reason (optional)
          </label>
          <input
            id="suspend-reason"
            type="text"
            value={reasonText}
            onChange={(event) => setReasonText(event.target.value)}
            className="w-full px-4 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-150 mb-3"
            placeholder="Why is this account being suspended?"
          />
          <button
            type="button"
            disabled={actionPending}
            onClick={handleSuspend}
            className="inline-flex items-center px-6 py-2.5 text-sm font-semibold text-error border border-red-200 rounded-lg hover:bg-error-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {actionPending ? 'Suspending…' : 'Suspend account'}
          </button>
          {actionErrorLine}
        </div>
      )
    }
  }

  let suspendedRow = null
  if (member.suspended_at !== null) {
    suspendedRow = (
      <div>
        <dt className="text-xs font-medium text-text-muted uppercase tracking-wide">Suspended since</dt>
        <dd className="mt-1 text-sm text-text">{formatTimestamp(member.suspended_at)}</dd>
      </div>
    )
  }

  return (
    <section>
      {backLink}
      <div className="max-w-lg mx-auto mt-4">
        <div className="bg-surface rounded-xl border border-border p-8 shadow-sm">
          <div className="flex items-start justify-between mb-6">
            <h1 className="text-2xl font-bold text-text">{member.name}</h1>
            <span className={'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 ml-3 ' + getStatusBadgeClasses(member.status)}>
              {member.status}
            </span>
          </div>
          <dl className="space-y-4">
            <div>
              <dt className="text-xs font-medium text-text-muted uppercase tracking-wide">Email</dt>
              <dd className="mt-1 text-sm text-text">{member.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-text-muted uppercase tracking-wide">Role</dt>
              <dd className="mt-1 text-sm text-text">{member.role}</dd>
            </div>
            <div className="border-t border-border pt-4">
              <dt className="text-xs font-medium text-text-muted uppercase tracking-wide">Display name</dt>
              <dd className="mt-1 text-sm text-text">{member.display_name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-text-muted uppercase tracking-wide">Contact preference</dt>
              <dd className="mt-1 text-sm text-text">{member.contact_preference ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-text-muted uppercase tracking-wide">Neighborhood</dt>
              <dd className="mt-1 text-sm text-text">{member.neighborhood ?? '—'}</dd>
            </div>
            <div className="border-t border-border pt-4">
              <dt className="text-xs font-medium text-text-muted uppercase tracking-wide">Member since</dt>
              <dd className="mt-1 text-sm text-text">{formatTimestamp(member.created_at)}</dd>
            </div>
            {suspendedRow}
          </dl>
          {suspendControl}
        </div>
      </div>
    </section>
  )
}

export default AdminMemberDetailPage
