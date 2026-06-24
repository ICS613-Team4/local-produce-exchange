import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'

import { sendDeactivateListingRequest, sendGetListingRequest } from '../services/listingService'
import type { ListingDetail, ListingResult } from '../services/listingService'
import { sendGetRequestQueuesRequest } from '../services/requestQueueService'
import type { RequestQueuesResponse } from '../services/requestQueueService'
import { authStateChangedEventName } from '../services/authService'
import { formatApiResult } from '../utils/formatApiResult'
import { formatTimestamp, getLocalTimeZoneName } from '../utils/formatTimestamp'

// One shared message for the not-logged-in case, declared at module scope so the
// wording is the same everywhere and it is not a useEffect dependency.
const notLoggedInMessage = 'You need to be logged in to see this page.'

function ListingDetailPage() {
  // Counts listing loads so an older response cannot overwrite a newer route.
  const latestRequestNumber = useRef(0)

  // The listing id comes from the URL, like /listings/<id>.
  const params = useParams()
  const listingId = params.id ?? ''

  // memberId is the single source of auth truth: logged in means it is not
  // empty. memberName is only the display text. Both live in state so the page
  // can switch the nav on logout or a stale-session 401 without a reload.
  const [memberId, setMemberId] = useState(window.localStorage.getItem('memberId') ?? '')
  const [memberName, setMemberName] = useState(window.localStorage.getItem('memberName') ?? '')

  // Holds the whole response. null means the listing has not loaded yet, which
  // doubles as the loading state, so no separate loading flag is needed.
  const [result, setResult] = useState<ListingResult | null>(null)
  const [resultListingId, setResultListingId] = useState('')

  // The deactivate control's state, each with one clear meaning.
  // isDeactivating: a deactivate request is in flight (greys the button).
  // deactivated: the listing has been deactivated (hides the owner actions).
  // deactivateMessage: the success or error text to show.
  const [isDeactivating, setIsDeactivating] = useState(false)
  const [deactivated, setDeactivated] = useState(false)
  const [deactivateMessage, setDeactivateMessage] = useState('')

  // Guards against a same-tick double-click on the SAME listing. It holds the
  // key (listing id + member id) of the deactivate request in flight, or an
  // empty string when none. A ref updates immediately (not after a re-render),
  // so two clicks fired in the same tick cannot both pass the check. Keying it
  // by listing means a request still in flight on one listing does not block a
  // click on a different listing the user navigated to.
  const isDeactivatingRef = useRef('')

  // Counts pending-count loads so an older count response cannot overwrite a
  // newer one. Separate from latestRequestNumber, which already guards the
  // listing load and the deactivate action.
  const latestPendingCountRequestNumber = useRef(0)

  // The owner-only pending-request count. null means hidden (not loaded yet, or
  // the count fetch failed); a number means show "Pending requests: N", even 0.
  const [pendingCount, setPendingCount] = useState<number | null>(null)

  // Reset the deactivate state whenever the route or the member changes, so it
  // never leaks from one listing (or one login) to the next. React allows
  // adjusting state during render this way when a value it depends on changes;
  // it is the recommended alternative to resetting inside an effect.
  const [previousListingId, setPreviousListingId] = useState(listingId)
  const [previousMemberId, setPreviousMemberId] = useState(memberId)
  if (previousListingId !== listingId || previousMemberId !== memberId) {
    setPreviousListingId(listingId)
    setPreviousMemberId(memberId)
    setIsDeactivating(false)
    setDeactivated(false)
    setDeactivateMessage('')
    // Clear the pending count too, so a previous listing's count never flashes
    // before the new listing's count loads.
    setPendingCount(null)
  }

  // Deactivate the listing the owner is viewing. The steps run in a set order so
  // the in-flight guard, the confirm, the stale-route guard, and the result
  // handling never trip over each other.
  async function handleDeactivate() {
    // The key for this click: the listing and member it acts on. Block only when
    // a request for this SAME key is already in flight (a same-tick double-click
    // on this listing). A request still in flight on a different listing has a
    // different key, so it does not block this click.
    const requestKey = listingId + '|' + memberId
    if (isDeactivatingRef.current === requestKey) {
      return
    }
    isDeactivatingRef.current = requestKey

    // Ask before doing it. On cancel, release the guard (only if this click still
    // owns it) and stop.
    const confirmed = window.confirm('Deactivate this listing? No new requests can be made on it.')
    if (confirmed === false) {
      if (isDeactivatingRef.current === requestKey) {
        isDeactivatingRef.current = ''
      }
      return
    }

    // Mark the request in flight (greys the button) and clear any prior message.
    setIsDeactivating(true)
    setDeactivateMessage('')

    // Remember which load this request belongs to, to compare after the await.
    // The load effect bumps latestRequestNumber on every route or member change,
    // so a different value afterward means the user moved on. This is the same
    // stale-response guard the listing load above uses.
    const requestNumberAtClick = latestRequestNumber.current
    const deactivateResult = await sendDeactivateListingRequest(listingId, memberId)

    // Release the re-entry guard, but only if this request still owns the key. A
    // later request for another listing may have taken it over; clearing it
    // unconditionally would drop that newer request's guard.
    if (isDeactivatingRef.current === requestKey) {
      isDeactivatingRef.current = ''
    }

    // Stale-route guard: if the user navigated to another listing (or logged
    // out) while this request was in flight, drop the response without touching
    // any state.
    if (requestNumberAtClick !== latestRequestNumber.current) {
      return
    }

    // The request has finished, whatever the outcome.
    setIsDeactivating(false)

    // Stale login: a 401 means the saved id no longer works. Clear the creds and
    // fall back to logged-out, exactly like the GET 401 path above.
    if (deactivateResult.status === 401) {
      window.localStorage.removeItem('memberId')
      window.localStorage.removeItem('memberName')
      window.localStorage.removeItem('memberEmail')
      setMemberId('')
      setMemberName('')
      // The route is not changing, so tell the shared nav the login was
      // cleared by firing the same-tab event it listens for.
      window.dispatchEvent(new Event(authStateChangedEventName))
      return
    }

    // Success: hide the owner actions and show a plain confirmation line. The
    // already-loaded detail text stays on screen (now stale) until the user
    // navigates; a re-fetch would 404, so we do not re-fetch.
    if (deactivateResult.ok === true) {
      setDeactivated(true)
      setDeactivateMessage('Listing deactivated.')
      return
    }

    // Failure, never silent. Pick the message by the same precedence the load
    // path uses: a transport error or timeout first, then the server's detail,
    // then a generic line so the message is never empty. The button stays
    // visible and enabled, so the user can try again right away.
    let failureMessage = 'Could not deactivate the listing. Please try again.'
    if (deactivateResult.errorMessage !== '') {
      failureMessage = deactivateResult.errorMessage
    } else if (typeof deactivateResult.data === 'object' && deactivateResult.data !== null) {
      const dataObject = deactivateResult.data as { detail?: unknown }
      if (typeof dataObject.detail === 'string') {
        failureMessage = dataObject.detail
      }
    }
    setDeactivateMessage(failureMessage)
  }

  // Load the listing when the page has a logged-in member. The request number
  // keeps an older response from replacing a newer route's response.
  useEffect(() => {
    latestRequestNumber.current = latestRequestNumber.current + 1
    if (memberId === '') {
      return
    }
    const requestNumber = latestRequestNumber.current
    async function loadListing() {
      const loadedResult = await sendGetListingRequest(listingId, memberId)
      if (requestNumber !== latestRequestNumber.current) {
        return
      }
      if (loadedResult.status === 401) {
        // The saved memberId no longer works (the member was deleted, say).
        // Clear the stale credentials exactly like logout, so the nav and the
        // content both fall back to the logged-out view.
        window.localStorage.removeItem('memberId')
        window.localStorage.removeItem('memberName')
        window.localStorage.removeItem('memberEmail')
        setMemberId('')
        setMemberName('')
        // The route is not changing, so tell the shared nav the login was
        // cleared by firing the same-tab event it listens for.
        window.dispatchEvent(new Event(authStateChangedEventName))
        return
      }
      setResult(loadedResult)
      setResultListingId(listingId)
    }
    loadListing()
  }, [listingId, memberId])

  // Work out whether the loaded listing belongs to the viewer, and its id. These
  // drive the owner-only pending-count fetch below. They are read off the loaded
  // result, so they are empty until the current listing has loaded.
  let loadedListingId = ''
  let loadedOwnerId = ''
  if (result !== null && result.ok && resultListingId === listingId) {
    const loadedListing = result.data as ListingDetail
    loadedListingId = loadedListing.id
    loadedOwnerId = loadedListing.owner_id
  }
  const viewerOwnsLoadedListing = loadedListingId !== '' && loadedOwnerId === memberId

  // Once the listing is loaded and the viewer owns it, fetch that listing's
  // pending-request count for the owner control. It uses its own stale-response
  // ref so a late count answer never disturbs the listing load or the deactivate
  // guard. A non-owner view, or any failure, leaves the count hidden.
  useEffect(() => {
    latestPendingCountRequestNumber.current = latestPendingCountRequestNumber.current + 1
    if (viewerOwnsLoadedListing === false) {
      // The count only shows inside the owner block, so a non-owner view needs
      // no fetch and no reset here (the render-time reset above clears it).
      return
    }
    const requestNumber = latestPendingCountRequestNumber.current
    async function loadPendingCount() {
      const countResult = await sendGetRequestQueuesRequest(memberId, loadedListingId)
      if (requestNumber !== latestPendingCountRequestNumber.current) {
        return
      }
      if (countResult.status === 401) {
        // Same stale-session handling as the listing-load and deactivate paths:
        // clear the creds, fall back to logged-out, and tell the shared nav.
        window.localStorage.removeItem('memberId')
        window.localStorage.removeItem('memberName')
        window.localStorage.removeItem('memberEmail')
        setMemberId('')
        setMemberName('')
        window.dispatchEvent(new Event(authStateChangedEventName))
        return
      }
      if (countResult.ok === false) {
        // Leave the count hidden on any other failure; the detail stays usable.
        setPendingCount(null)
        return
      }
      // The backend returns at most one group for this single listing. Read its
      // pending count, defaulting to 0 when the listing has no pending requests.
      const responseData = countResult.data as RequestQueuesResponse
      const groups = responseData.groups
      let count = 0
      for (let index = 0; index < groups.length; index = index + 1) {
        if (groups[index].listing_id === loadedListingId) {
          count = groups[index].pending.length
        }
      }
      setPendingCount(count)
    }
    loadPendingCount()
  }, [viewerOwnsLoadedListing, loadedListingId, memberId])

  // Show a short status line when logged in. The shared nav owns the log in and
  // log out controls now, so a logged-out viewer needs nothing here.
  let loggedInArea = null
  if (memberId !== '') {
    let loggedInLine = 'Logged in.'
    if (memberName !== '') {
      loggedInLine = 'Logged in as ' + memberName + '.'
    }
    loggedInArea = <p>{loggedInLine}</p>
  }

  // Build the content area with a plain if/else chain, checked in a set order.
  // Every branch assigns (the chain ends with a plain else), so no initial value.
  let contentArea
  if (memberId === '') {
    // A logged-out viewer cannot load details (the GET requires auth). This also
    // covers the just-cleared 401 case above.
    contentArea = <p role="alert">{notLoggedInMessage}</p>
  } else if (result === null || resultListingId !== listingId) {
    // First render, or a route change before the next response arrives.
    contentArea = <p>Loading the listing...</p>
  } else if (result.errorMessage !== '') {
    // A transport failure (timeout or network error); the service returns this
    // with status 0, so check it before the HTTP-status branches.
    contentArea = <p role="alert">{result.errorMessage}</p>
  } else if (result.ok) {
    // The backend owns this shape, so read the body with one plain cast.
    const listing = result.data as ListingDetail
    const ownerId = listing.owner_id
    // Show the tag lists as comma-separated text, with a plain fallback so an
    // empty list reads clearly instead of showing nothing.
    let dietaryText = listing.dietary_tags.join(', ')
    if (dietaryText === '') {
      dietaryText = 'None'
    }
    let allergenText = listing.allergen_tags.join(', ')
    if (allergenText === '') {
      allergenText = 'None'
    }
    // Render the timezone-aware pickup times in the viewer's own locale and
    // local time zone, instead of the raw ISO strings the backend sends. Each
    // formatted time already ends with the zone's short name (like "HST").
    const pickupStartText = formatTimestamp(listing.pickup_start)
    const pickupEndText = formatTimestamp(listing.pickup_end)
    const postedText = formatTimestamp(listing.created_at)
    // Spell out, in plain words, that the times above are in the viewer's own
    // local zone, the way calendar and event sites do. We add the IANA zone
    // name (like "Pacific/Honolulu") when the browser can report it.
    const localTimeZoneName = getLocalTimeZoneName()
    let timeZoneNote = 'All times are shown in your local time zone.'
    if (localTimeZoneName !== '') {
      timeZoneNote = 'All times are shown in your local time zone (' + localTimeZoneName + ').'
    }
    // The owner actions: the Edit link and the Deactivate button, shown together
    // only while the listing has not been deactivated. Once deactivated is true,
    // the whole block renders nothing, so both controls disappear at once.
    let ownerActionsArea = null
    if (memberId === ownerId && deactivated === false) {
      // The pending-request count line only shows once the count has loaded; it
      // stays hidden while loading or after a count-fetch failure.
      let pendingCountLine = null
      if (pendingCount !== null) {
        pendingCountLine = <p>Pending requests: {pendingCount}</p>
      }
      ownerActionsArea = (
        <>
          <p>
            <Link to={'/listings/' + listing.id + '/edit'}>Edit listing</Link>
          </p>
          <p>
            <button onClick={handleDeactivate} disabled={isDeactivating}>
              Deactivate listing
            </button>
          </p>
          {pendingCountLine}
          <p>
            <Link to={'/requests?listing=' + listing.id}>View requests</Link>
          </p>
        </>
      )
    }

    // The deactivate result message. On success it is plain confirmation text;
    // on failure it is a role="alert" so it is announced. It is built here,
    // inside the loaded current-listing branch, so a message from a previous
    // listing cannot flash for one frame after a route change.
    let deactivateMessageArea = null
    if (deactivated === true) {
      deactivateMessageArea = <p>{deactivateMessage}</p>
    } else if (deactivateMessage !== '') {
      deactivateMessageArea = <p role="alert">{deactivateMessage}</p>
    }
    // Quantity available (what the poster entered) and remaining quantity (what
    // is left) are two different numbers, so label each on its own line.
    contentArea = (
      <article>
        <h2>{listing.title}</h2>
        <p>{listing.description}</p>
        <p>Posted on: {postedText}</p>
        <p>Category: {listing.category}</p>
        <p>Quantity available: {listing.total_quantity}</p>
        <p>Remaining quantity: {listing.remaining_quantity}</p>
        <p>Dietary tags: {dietaryText}</p>
        <p>Allergen tags: {allergenText}</p>
        <p>Pickup Window Start: {pickupStartText}</p>
        <p>Pickup Window End: {pickupEndText}</p>
        <p>
          <small>{timeZoneNote}</small>
        </p>
        {ownerActionsArea}
        {deactivateMessageArea}
      </article>
    )
  } else if (result.status === 404) {
    contentArea = <p role="alert">This listing is unavailable.</p>
  } else {
    // Any other HTTP failure (for example 403 or 503). Show the detail message
    // and the raw response, like the create page does.
    let detail: unknown = undefined
    if (typeof result.data === 'object' && result.data !== null) {
      const dataObject = result.data as { detail?: unknown }
      detail = dataObject.detail
    }
    let detailMessage = 'Could not load the listing (HTTP ' + result.status + ').'
    if (typeof detail === 'string') {
      detailMessage = detail
    }
    contentArea = (
      <>
        <p role="alert">{detailMessage}</p>
        <pre style={{ border: '1px solid black', padding: '10px', whiteSpace: 'pre-wrap' }}>
          {formatApiResult(result.ok, result.status, result.data)}
        </pre>
      </>
    )
  }

  return (
    <section>
      <h1>Listing details</h1>
      {loggedInArea}
      {contentArea}
    </section>
  )
}

export default ListingDetailPage
