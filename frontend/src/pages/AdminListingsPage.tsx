import { useEffect, useRef, useState } from 'react'

import { clearStoredLogin } from '../services/authService'
import {
  getAdminListings,
  type AdminListingSummary,
  type AdminListingResult,
  updateAdminListingStatus,
} from '../services/adminListingService'

function resultMessage(result: AdminListingResult, fallback: string): string {
  if (result.errorMessage !== '') {
    return result.errorMessage
  }
  if (typeof result.data === 'object' && result.data !== null) {
    const detail = (result.data as { detail?: unknown }).detail
    if (typeof detail === 'string') {
      return detail
    }
  }
  return fallback
}

function AdminListingsPage() {
  const memberId = window.localStorage.getItem('memberId') ?? ''
  const [listings, setListings] = useState<AdminListingSummary[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const [actingListingId, setActingListingId] = useState('')
  const actionInFlight = useRef('')

  useEffect(() => {
    let cancelled = false

    async function loadListings() {
      const result = await getAdminListings(memberId)
      if (cancelled) {
        return
      }
      if (result.status === 401) {
        clearStoredLogin()
        return
      }
      if (!result.ok) {
        setLoadError(resultMessage(result, 'Could not load listings.'))
        return
      }
      setListings(result.data as AdminListingSummary[])
    }

    loadListings()
    return () => {
      cancelled = true
    }
  }, [memberId])

  async function handleAction(listing: AdminListingSummary) {
    const action = listing.status === 'active' ? 'deactivate' : 'reactivate'
    const requestKey = listing.id + '|' + action
    if (actionInFlight.current !== '') {
      return
    }

    const confirmed = window.confirm(
      action === 'deactivate'
        ? 'Deactivate this listing? It will be hidden from browsing and pending requests will be cancelled.'
        : 'Reactivate this listing? It will appear in browsing again.',
    )
    if (!confirmed) {
      return
    }

    actionInFlight.current = requestKey
    setActingListingId(listing.id)
    setActionMessage('')
    setActionError('')
    const result = await updateAdminListingStatus(listing.id, memberId, action)
    actionInFlight.current = ''
    setActingListingId('')

    if (result.status === 401) {
      clearStoredLogin()
      return
    }
    if (!result.ok) {
      setActionError(resultMessage(result, 'Could not update the listing.'))
      return
    }

    setListings((currentListings) => {
      if (currentListings === null) {
        return currentListings
      }
      return currentListings.map((currentListing) => {
        if (currentListing.id !== listing.id) {
          return currentListing
        }
        if (action === 'deactivate') {
          return {
            ...currentListing,
            status: 'deactivated',
            deactivated_by: memberId,
          }
        }
        return {
          ...currentListing,
          status: 'active',
          deactivated_by: null,
        }
      })
    })
    setActionMessage(
      listing.title + (action === 'deactivate' ? ' deactivated.' : ' reactivated.'),
    )
  }

  let content
  if (loadError !== '') {
    content = <p className="text-sm text-error" role="alert">{loadError}</p>
  } else if (listings === null) {
    content = <p className="text-sm text-text-muted">Loading listings...</p>
  } else if (listings.length === 0) {
    content = <p className="text-sm text-text-muted">No listings found.</p>
  } else {
    content = (
      <div className="space-y-3">
        {listings.map((listing) => {
          const isActive = listing.status === 'active'
          const isDeactivated = listing.status === 'deactivated'
          let stateDetail = listing.status
          if (isActive) {
            stateDetail = 'Active and visible in browsing'
          } else if (isDeactivated && listing.deactivated_by === null) {
            stateDetail = 'Deactivated by owner'
          } else if (isDeactivated) {
            stateDetail = 'Deactivated by an administrator'
          }
          const isActing = actingListingId === listing.id
          let actionButton = null
          if (isActive || isDeactivated) {
            const actionLabel = isActive ? 'Deactivate' : 'Reactivate'
            actionButton = (
              <button
                type="button"
                aria-label={actionLabel + ' ' + listing.title}
                disabled={actingListingId !== ''}
                onClick={() => handleAction(listing)}
                className={
                  isActive
                    ? 'inline-flex items-center justify-center rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-error hover:bg-error-bg disabled:opacity-50'
                    : 'inline-flex items-center justify-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-text-inverse hover:bg-primary-700 disabled:opacity-50'
                }
              >
                {isActing ? 'Updating…' : actionLabel}
              </button>
            )
          }
          return (
            <article
              key={listing.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <h2 className="font-semibold text-text">{listing.title}</h2>
                <p className="text-sm text-text-muted">{listing.owner_name}</p>
                <p className="mt-1 text-xs text-text-muted">{stateDetail}</p>
              </div>
              {actionButton}
            </article>
          )
        })}
      </div>
    )
  }

  return (
    <section className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-text">Manage Listings</h1>
        <p className="mt-2 text-sm text-text-muted">
          Deactivate any active listing or reactivate any listing taken down by its owner or an administrator.
        </p>
      </div>
      {actionMessage !== '' ? (
        <p className="mb-4 rounded-lg border border-green-200 bg-success-bg px-4 py-3 text-sm text-success" role="status">
          {actionMessage}
        </p>
      ) : null}
      {actionError !== '' ? (
        <p className="mb-4 rounded-lg border border-red-200 bg-error-bg px-4 py-3 text-sm text-error" role="alert">
          {actionError}
        </p>
      ) : null}
      {content}
    </section>
  )
}

export default AdminListingsPage
