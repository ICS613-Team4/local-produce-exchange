import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import {
  sendDeactivateListingRequest,
  sendGetMyListingsRequest,
} from '../services/listingService'
import type { ListingDetail, ListingResult } from '../services/listingService'
import { authStateChangedEventName } from '../services/authService'
import { formatTimestamp, getLocalTimeZoneNote } from '../utils/formatTimestamp'

// One shared message for the not-logged-in case, declared at module scope so the
// wording is the same everywhere and it is not a useEffect dependency.
const notLoggedInMessage = 'You need to be logged in to see this page.'

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
  const [memberId, setMemberId] = useState(window.localStorage.getItem('memberId') ?? '')

  // Holds the whole response. null means it has not loaded yet, which doubles as
  // the loading state.
  const [result, setResult] = useState<ListingResult | null>(null)

  // Bumped after a successful deactivate to re-run the load effect, so the row
  // updates to its new status without a full page reload.
  const [reloadCounter, setReloadCounter] = useState(0)

  // The listing id whose deactivate request is in flight, so only that row's
  // button is greyed while it runs.
  const [deactivatingId, setDeactivatingId] = useState('')

  // A failure message from a deactivate attempt, shown inline.
  const [actionError, setActionError] = useState('')

  // Blocks a same-tick double-click on one row's Deactivate button. Holds the
  // key of the request in flight (listing id plus member id), like
  // ListingDetailPage's deactivate guard.
  const deactivateInFlightRef = useRef('')

  // Load the caller's listings when the page has a logged-in member, and again
  // whenever reloadCounter changes (after a successful deactivate).
  useEffect(() => {
    latestRequestNumber.current = latestRequestNumber.current + 1
    if (memberId === '') {
      return
    }
    const requestNumber = latestRequestNumber.current
    async function loadMyListings() {
      const loadedResult = await sendGetMyListingsRequest(memberId)
      if (requestNumber !== latestRequestNumber.current) {
        return
      }
      if (loadedResult.status === 401) {
        // The saved memberId no longer works. Clear the stale credentials exactly
        // like logout, so the nav and the content both fall back to logged-out.
        window.localStorage.removeItem('memberId')
        window.localStorage.removeItem('memberName')
        window.localStorage.removeItem('memberEmail')
        setMemberId('')
        window.dispatchEvent(new Event(authStateChangedEventName))
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

  // Deactivate one active listing the owner views. Copies the ListingDetailPage
  // deactivate handler shape: a same-tick double-click guard, a confirm, the
  // call, then the result handling. On success, bump reloadCounter so the list
  // reloads and the row updates.
  async function handleDeactivate(listingId: string) {
    const requestKey = listingId + '|' + memberId
    if (deactivateInFlightRef.current === requestKey) {
      return
    }
    deactivateInFlightRef.current = requestKey

    const confirmed = window.confirm('Deactivate this listing? No new requests can be made on it.')
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

    // Stale login: a 401 means the saved id no longer works. Clear the creds and
    // fall back to logged-out, the same as the load path above.
    if (deactivateResult.status === 401) {
      window.localStorage.removeItem('memberId')
      window.localStorage.removeItem('memberName')
      window.localStorage.removeItem('memberEmail')
      setMemberId('')
      window.dispatchEvent(new Event(authStateChangedEventName))
      return
    }

    if (deactivateResult.ok === true) {
      // Reload the list so the just-deactivated row shows its new status.
      setReloadCounter((currentValue) => currentValue + 1)
      return
    }

    // Failure, never silent. Pick the message by the same precedence the other
    // pages use: a transport error first, then the server's detail, then a
    // generic line so the message is never empty.
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

  // Build one listing row: the title, a status label, the posted date, and the
  // per-row controls chosen by an if/else chain on the listing's state.
  //
  // ponytail: the existing GET/PUT listing endpoints only act on active
  // listings, so a non-active row's title is plain text (the detail page returns
  // "This listing is unavailable" for it) and its Edit link is hidden until
  // those endpoints are widened. Left as-is for this slice.
  function buildListingRow(listing: ListingDetail) {
    const postedText = formatTimestamp(listing.created_at)
    const statusLabel = buildStatusLabel(listing)

    // Active titles link to the detail page; non-active titles are plain text.
    let titleNode
    if (listing.status === 'active') {
      titleNode = <Link to={'/listings/' + listing.id}>{listing.title}</Link>
    } else {
      titleNode = <span>{listing.title}</span>
    }

    // The per-row controls.
    let controls
    if (isAdminDeactivated(listing)) {
      // The member can do nothing to an admin-deactivated listing.
      controls = (
        <p>An administrator deactivated this listing, so you cannot edit or change it.</p>
      )
    } else if (listing.status === 'active') {
      // Active: edit, a disabled Activate (no member-activate endpoint yet), and
      // a working Deactivate.
      const isThisRowPending = deactivatingId === listing.id
      controls = (
        <p>
          <Link to={'/listings/' + listing.id + '/edit'}>Edit</Link>{' '}
          <button type="button" disabled>
            Activate listing
          </button>{' '}
          <button
            type="button"
            disabled={isThisRowPending}
            onClick={() => handleDeactivate(listing.id)}
          >
            Deactivate listing
          </button>
        </p>
      )
    } else {
      // Owner-deactivated, or any other non-admin non-active status: the owner
      // can act on it, so Activate is enabled. There is no member-activate
      // endpoint yet, so the click just tells them it is not built. Deactivate
      // stays disabled because the listing is already deactivated.
      controls = (
        <>
          <p>
            <button
              type="button"
              onClick={() => window.alert('Reactivating a listing will be implemented in User Story 31.')}
            >
              Activate listing
            </button>{' '}
            <button type="button" disabled>
              Deactivate listing
            </button>
          </p>
          <p>This listing cannot be edited or changed until reactivation is implemented.</p>
        </>
      )
    }

    return (
      <li key={listing.id}>
        {titleNode} - {statusLabel} (posted on: {postedText})
        {controls}
      </li>
    )
  }

  // The note that tells the viewer the times on this page are in their local zone.
  const timeZoneNote = getLocalTimeZoneNote()

  // Build the content area with a plain if/else chain, checked in a set order.
  let contentArea
  if (memberId === '') {
    contentArea = <p role="alert">{notLoggedInMessage}</p>
  } else if (result === null) {
    contentArea = <p>Loading your listings...</p>
  } else if (result.errorMessage !== '') {
    contentArea = <p role="alert">{result.errorMessage}</p>
  } else if (result.ok) {
    const listings = result.data as ListingDetail[]
    if (listings.length === 0) {
      contentArea = <p>You have not posted any listings yet.</p>
    } else {
      const rows = []
      for (let index = 0; index < listings.length; index = index + 1) {
        rows.push(buildListingRow(listings[index]))
      }
      contentArea = (
        <>
          <ul>{rows}</ul>
          <p>
            <small>{timeZoneNote}</small>
          </p>
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
    contentArea = <p role="alert">{detailMessage}</p>
  }

  // A failed deactivate shows its message above the list, without hiding it.
  let actionErrorArea = null
  if (actionError !== '') {
    actionErrorArea = <p role="alert">{actionError}</p>
  }

  return (
    <section>
      <h1>Browse My Listings</h1>
      {actionErrorArea}
      {contentArea}
    </section>
  )
}

export default MyListingsPage
