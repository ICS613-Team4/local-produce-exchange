import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { Link } from 'react-router'

import {
  sendDeactivateListingRequest,
  sendGetMyListingsRequest,
  sendReactivateListingRequest,
} from '../services/listingService'
import type { ListingDetail, ListingResult } from '../services/listingService'
import { clearStoredLogin } from '../services/authService'
import { formatTimestamp, getLocalTimeZoneNote } from '../utils/formatTimestamp'

// One shared message for the not-logged-in case, declared at module scope so the
// wording is the same everywhere and it is not a useEffect dependency.
// "Browse My Listings": every listing the logged-in member owns, active and
// deactivated, newest first. The owner can deactivate an active listing here.
// Deactivated listings are shown read-only.
function MyListingsPage() {
  // Counts loads so an older response cannot overwrite a newer one (for example
  // after a deactivate reload or a stale session being cleared).
  const latestRequestNumber = useRef(0)

  // memberId is the auth truth: logged in means it is not empty. It lives in
  // state so a stale-session 401 can flip the page to logged-out without a
  // reload, the same as MyRequestsPage.
  const memberId = window.localStorage.getItem('memberId') ?? ''

  // Holds the whole response. null means it has not loaded yet, which doubles as
  // the loading state.
  const [result, setResult] = useState<ListingResult | null>(null)

  // Bumped after a successful status change to re-run the load effect, so the
  // row updates without a full page reload.
  const [reloadCounter, setReloadCounter] = useState(0)

  // The listing id whose deactivate request is in flight, so only that row's
  // button is greyed while it runs.
  const [deactivatingId, setDeactivatingId] = useState('')

  // The listing id whose reactivate request is in flight, so only that row's
  // button is greyed while it runs.
  const [reactivatingId, setReactivatingId] = useState('')

  // A failure message from a listing action, shown inline.
  const [actionError, setActionError] = useState('')

  // Blocks a same-tick double-click on one row's Deactivate button. Holds the
  // key of the request in flight (listing id plus member id), like
  // ListingDetailPage's deactivate guard.
  const deactivateInFlightRef = useRef('')

  // Blocks a same-tick double-click on one row's Activate button. Holds the key
  // of the request in flight (listing id plus member id).
  const reactivateInFlightRef = useRef('')

  // Load the caller's listings when the page has a logged-in member, and again
  // whenever reloadCounter changes after a successful status change.
  useEffect(() => {
    latestRequestNumber.current = latestRequestNumber.current + 1
    const requestNumber = latestRequestNumber.current
    async function loadMyListings() {
      const loadedResult = await sendGetMyListingsRequest(memberId)
      if (requestNumber !== latestRequestNumber.current) {
        return
      }
      if (loadedResult.status === 401) {
        // The saved memberId no longer works. Clear the stale credentials exactly
        // like logout, so the nav and the content both fall back to logged-out.
        clearStoredLogin()
        return
      }
      setResult(loadedResult)
    }
    loadMyListings()
  }, [memberId, reloadCounter])

  // True only when an admin deactivated this listing (status deactivated and
  // deactivated_by set). An owner deactivation leaves deactivated_by null.
  function isAdminDeactivated(listing: ListingDetail) {
    if (listing.status !== 'deactivated') {
      return false
    }
    if (listing.deactivated_by === null || listing.deactivated_by === undefined) {
      return false
    }
    return true
  }

  // A short status label for one row.
  function buildStatusLabel(listing: ListingDetail) {
    if (listing.status === 'active') {
      return 'Active'
    }
    if (listing.status === 'deactivated') {
      if (isAdminDeactivated(listing)) {
        return 'Administratively deactivated'
      }
      return 'Deactivated'
    }
    return listing.status
  }

  function getStatusBadgeClasses(listing: ListingDetail) {
    if (listing.status === 'active') {
      return 'bg-primary-50 text-primary-700'
    }
    if (isAdminDeactivated(listing)) {
      return 'bg-red-50 text-error'
    }
    return 'bg-background-alt text-text-muted'
  }

  // Deactivate one active listing the owner views.
  async function handleDeactivate(event: MouseEvent<HTMLButtonElement>) {
    const listingId = event.currentTarget.value
    const requestKey = listingId + '|' + memberId
    if (deactivateInFlightRef.current === requestKey) {
      return
    }
    deactivateInFlightRef.current = requestKey

    const confirmed = window.confirm('Deactivate this listing? No new requests can be made on it, and its pending requests are cancelled. Exchanges already approved or picked up carry on.')
    if (confirmed === false) {
      if (deactivateInFlightRef.current === requestKey) {
        deactivateInFlightRef.current = ''
      }
      return
    }

    setDeactivatingId(listingId)
    setActionError('')

    const deactivateResult = await sendDeactivateListingRequest(listingId, memberId)

    if (deactivateInFlightRef.current === requestKey) {
      deactivateInFlightRef.current = ''
    }

    setDeactivatingId('')

    if (deactivateResult.status === 401) {
      clearStoredLogin()
      return
    }

    if (deactivateResult.ok === true) {
      setReloadCounter((currentValue) => currentValue + 1)
      return
    }

    let failureMessage = 'Could not deactivate the listing. Please try again.'
    if (deactivateResult.errorMessage !== '') {
      failureMessage = deactivateResult.errorMessage
    } else if (typeof deactivateResult.data === 'object' && deactivateResult.data !== null) {
      const dataObject = deactivateResult.data as { detail?: unknown }
      if (typeof dataObject.detail === 'string') {
        failureMessage = dataObject.detail
      }
    }
    setActionError(failureMessage)
  }

  async function handleReactivate(event: MouseEvent<HTMLButtonElement>) {
    const listingId = event.currentTarget.value
    const requestKey = listingId + '|' + memberId
    if (reactivateInFlightRef.current === requestKey) {
      return
    }
    reactivateInFlightRef.current = requestKey

    const confirmed = window.confirm(
      'Reactivate this listing? It will show up in browsing again and can take new requests.',
    )
    if (confirmed === false) {
      if (reactivateInFlightRef.current === requestKey) {
        reactivateInFlightRef.current = ''
      }
      return
    }

    setReactivatingId(listingId)
    setActionError('')

    const reactivateResult = await sendReactivateListingRequest(listingId, memberId)

    if (reactivateInFlightRef.current === requestKey) {
      reactivateInFlightRef.current = ''
    }

    setReactivatingId('')

    if (reactivateResult.status === 401) {
      clearStoredLogin()
      return
    }

    if (reactivateResult.ok === true) {
      setReloadCounter((currentValue) => currentValue + 1)
      return
    }

    let failureMessage = 'Could not reactivate the listing. Please try again.'
    if (reactivateResult.errorMessage !== '') {
      failureMessage = reactivateResult.errorMessage
    } else if (typeof reactivateResult.data === 'object' && reactivateResult.data !== null) {
      const dataObject = reactivateResult.data as { detail?: unknown }
      if (typeof dataObject.detail === 'string') {
        failureMessage = dataObject.detail
      }
    }
    setActionError(failureMessage)
  }

  function buildListingRow(listing: ListingDetail) {
    const postedText = formatTimestamp(listing.created_at)
    const statusLabel = buildStatusLabel(listing)
    const badgeClasses = getStatusBadgeClasses(listing)

    let titleNode
    if (listing.status === 'active') {
      // No color classes on the link: the site's base link style in app.css
      // colors every link and darkens it on hover, so this title matches the
      // listing links on the my-requests and requests pages.
      titleNode = (
        <Link to={'/listings/' + listing.id} className="text-base font-semibold">
          {listing.title}
        </Link>
      )
    } else {
      titleNode = <span className="text-base font-semibold text-text-muted">{listing.title}</span>
    }

    let controls
    if (isAdminDeactivated(listing)) {
      controls = (
        <p className="text-xs text-error mt-2">
          An administrator deactivated this listing, so you cannot edit or change it.
        </p>
      )
    } else if (listing.status === 'active') {
      const isThisRowPending = deactivatingId === listing.id
      controls = (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Link
            to={'/listings/' + listing.id + '/edit'}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-primary-600 border border-primary-200 rounded-md hover:bg-primary-50 transition-colors"
          >
            Edit
          </Link>
          <button
            type="button"
            value={listing.id}
            disabled={isThisRowPending}
            onClick={handleDeactivate}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-error border border-red-200 rounded-md hover:bg-error-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isThisRowPending ? 'Deactivating…' : 'Deactivate'}
          </button>
          <button type="button" disabled className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-text-muted border border-border rounded-md opacity-50 cursor-not-allowed">
            Activate listing
          </button>
        </div>
      )
    } else {
      const isThisRowReactivating = reactivatingId === listing.id
      controls = (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button
            type="button"
            value={listing.id}
            disabled={isThisRowReactivating}
            onClick={handleReactivate}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-primary-600 border border-primary-200 rounded-md hover:bg-primary-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Activate listing
          </button>
          <button type="button" disabled className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-text-muted border border-border rounded-md opacity-50 cursor-not-allowed">
            Deactivate listing
          </button>
        </div>
      )
    }

    // The listing's first photo renders as a small square thumbnail on the
    // left of the row, the way seller-dashboard lists show items. A listing
    // with no photos renders no image and the text fills the row.
    let thumbnailArea = null
    if (listing.photos !== undefined && listing.photos.length > 0) {
      thumbnailArea = (
        <img
          src={'/api/photos/' + listing.photos[0].id}
          alt={listing.title}
          loading="lazy"
          className="w-20 h-20 sm:w-24 sm:h-24 object-cover rounded-lg border border-border shrink-0"
        />
      )
    }

    return (
      <li key={listing.id} className="bg-surface rounded-xl border border-border p-5 shadow-sm">
        <div className="flex items-start gap-4">
          {thumbnailArea}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between">
              <div>
                {titleNode}
                <p className="text-xs text-text-muted mt-1">Posted {postedText}</p>
              </div>
              <span className={'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 ml-3 ' + badgeClasses}>
                {statusLabel}
              </span>
            </div>
            {controls}
          </div>
        </div>
      </li>
    )
  }

  // The note that tells the viewer the times on this page are in their local zone.
  const timeZoneNote = getLocalTimeZoneNote()

  // Build the content area with a plain if/else chain, checked in a set order.
  let contentArea
  if (result === null) {
    contentArea = <p className="text-text-muted text-sm py-8 text-center">Loading your listings...</p>
  } else if (result.errorMessage !== '') {
    contentArea = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
        {result.errorMessage}
      </div>
    )
  } else if (result.ok) {
    const listings = result.data as ListingDetail[]
    if (listings.length === 0) {
      contentArea = (
        <div className="text-center py-12">
          <span className="text-4xl mb-4 block">📦</span>
          <p className="text-text-muted">You have not posted any listings yet.</p>
          <Link
            to="/listings/create"
            className="mt-4 inline-flex items-center px-6 py-2.5 text-sm font-semibold text-text-inverse bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm transition-all duration-150"
          >
            Create your first listing
          </Link>
        </div>
      )
    } else {
      const rows = []
      for (let index = 0; index < listings.length; index = index + 1) {
        rows.push(buildListingRow(listings[index]))
      }
      // The time-zone note shows above and below the list, so it is visible
      // without scrolling and again next to the last timestamps on the page.
      contentArea = (
        <>
          <p className="text-xs text-text-muted mb-4">{timeZoneNote}</p>
          <ul className="space-y-4">{rows}</ul>
          <p className="text-xs text-text-muted mt-4">{timeZoneNote}</p>
        </>
      )
    }
  } else {
    let detailMessage = 'Could not load your listings. Please try again.'
    if (typeof result.data === 'object' && result.data !== null) {
      const dataObject = result.data as { detail?: unknown }
      if (typeof dataObject.detail === 'string') {
        detailMessage = dataObject.detail
      }
    }
    contentArea = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
        {detailMessage}
      </div>
    )
  }

  // A failed listing action shows its message above the list, without hiding it.
  let actionErrorArea = null
  if (actionError !== '') {
    actionErrorArea = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error mb-4" role="alert">
        {actionError}
      </div>
    )
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-text">Listings You Own</h1>
        <Link
          to="/listings/create"
          className="inline-flex items-center px-5 py-2.5 text-sm font-semibold text-text-inverse bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm transition-all duration-150"
        >
          + New listing
        </Link>
      </div>
      {actionErrorArea}
      {contentArea}
    </section>
  )
}

export default MyListingsPage
