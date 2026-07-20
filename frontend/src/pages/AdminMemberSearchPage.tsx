import { useState } from 'react'
import { Link } from 'react-router'

import {
  searchMembers,
  type AdminMemberResult,
  type AdminMemberSummary,
} from '../services/adminMemberService'

// Status badge colors, the same bg-*-bg/text-* pairing MyRequestsPage and
// MyListingsPage use for their status badges. Suspended reads as an error
// (red), active as success (green); any other status (for example "inactive")
// falls back to a neutral gray rather than guessing a color for it.
function getStatusBadgeClasses(status: string): string {
  if (status === 'active') return 'bg-success-bg text-success'
  if (status === 'suspended') return 'bg-error-bg text-error'
  return 'bg-background-alt text-text-muted'
}

function AdminMemberSearchPage() {
  const memberId = window.localStorage.getItem('memberId') ?? ''

  const [searchText, setSearchText] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
  // Holds the whole response. null means a search is in flight (or none has
  // run yet, guarded separately by hasSearched).
  const [result, setResult] = useState<AdminMemberResult | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setResult(null)
    setHasSearched(true)
    const searchResult = await searchMembers(searchText, memberId)
    setResult(searchResult)
  }

  const inputClasses = 'w-full px-4 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-150'

  // Build the results area with a plain if/else chain, only once a search has
  // actually run (Scenario 1: the admin searches; there is nothing to show
  // before that).
  let resultsArea = null
  if (hasSearched) {
    if (result === null) {
      resultsArea = <p className="text-text-muted text-sm py-8 text-center">Searching&hellip;</p>
    } else if (result.errorMessage !== '') {
      resultsArea = (
        <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
          {result.errorMessage}
        </div>
      )
    } else if (result.ok) {
      // Scenario 2: no matches shows an empty result, not an error.
      const members = result.data as AdminMemberSummary[]
      if (members.length === 0) {
        resultsArea = <p className="text-text-muted text-sm py-8 text-center">No members match that search.</p>
      } else {
        const rows = []
        for (let index = 0; index < members.length; index = index + 1) {
          const member = members[index]
          rows.push(
            <li key={member.id} className="py-3 flex items-center justify-between">
              <div className="min-w-0">
                <Link
                  to={'/admin/members/' + member.id}
                  className="font-medium text-primary-600 hover:text-primary-700"
                >
                  {member.name}
                </Link>
                <p className="text-sm text-text-muted">{member.email}</p>
              </div>
              <span className={'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 ml-3 ' + getStatusBadgeClasses(member.status)}>
                {member.status}
              </span>
            </li>,
          )
        }
        resultsArea = (
          <div className="bg-surface rounded-xl border border-border p-6 shadow-sm">
            <ul className="divide-y divide-border">{rows}</ul>
          </div>
        )
      }
    } else {
      // Scenario 4: a non-admin caller cannot reach this page (RequireAdmin
      // blocks it), but any other HTTP failure (for example 503) lands here.
      let detail: unknown = undefined
      if (typeof result.data === 'object' && result.data !== null) {
        detail = (result.data as { detail?: unknown }).detail
      }
      let detailMessage = 'Could not search members (HTTP ' + result.status + ').'
      if (typeof detail === 'string') {
        detailMessage = detail
      }
      resultsArea = (
        <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
          {detailMessage}
        </div>
      )
    }
  }

  return (
    <section>
      <h1 className="text-3xl font-bold text-text mb-6">Search members</h1>

      <div className="bg-surface rounded-xl border border-border p-6 shadow-sm mb-8">
        <form onSubmit={handleSubmit} className="flex items-end gap-4">
          <div className="flex-1">
            <label htmlFor="admin-member-search" className="block text-sm font-medium text-text mb-1.5">
              Name or email
            </label>
            <input
              id="admin-member-search"
              type="text"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              className={inputClasses}
              placeholder="Search by name or email&hellip;"
            />
          </div>
          <button
            type="submit"
            className="inline-flex items-center px-6 py-2.5 text-sm font-semibold text-text-inverse bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm transition-all duration-150"
          >
            Search
          </button>
        </form>
      </div>

      {resultsArea}
    </section>
  )
}

export default AdminMemberSearchPage
