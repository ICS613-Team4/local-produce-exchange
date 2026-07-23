import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'

import { clearStoredLogin } from '../services/authService'
import {
  getAdminMemberDetail,
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
  // schema to arbitrate one admin acting on another.
  let suspendControl = null
  if (member.role !== 'admin') {
    if (member.status === 'suspended') {
      suspendControl = (
        <button
          type="button"
          disabled
          className="mt-6 inline-flex items-center px-6 py-2.5 text-sm font-semibold text-text-muted border border-border rounded-lg opacity-50 cursor-not-allowed"
        >
          Reinstate account
        </button>
      )
    } else {
      suspendControl = (
        <button
          type="button"
          disabled
          className="mt-6 inline-flex items-center px-6 py-2.5 text-sm font-semibold text-text-muted border border-border rounded-lg opacity-50 cursor-not-allowed"
        >
          Suspend account
        </button>
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
