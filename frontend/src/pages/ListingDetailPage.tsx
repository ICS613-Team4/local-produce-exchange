import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'

import { sendDeactivateListingRequest, sendGetListingRequest } from '../services/listingService'
import type { ListingDetail, ListingResult } from '../services/listingService'
import {
  sendConfirmPickupRequest,
  sendCreateClaimRequest,
  sendGetMyClaimRequest,
  sendGetRequestQueuesRequest,
} from '../services/requestQueueService'
import type {
  ClaimDecisionResponse,
  RequestQueuesResponse,
} from '../services/requestQueueService'
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

  // The non-owner request form's state.
  // requestQuantity: the textfield value, kept as a string so the input stays
  //   controlled and an empty field reads as empty (not 0).
  // isRequesting: a submit is in flight, which greys the button.
  // requestMessage: the error line shown under the form on a failed submit.
  const [requestQuantity, setRequestQuantity] = useState('')
  const [isRequesting, setIsRequesting] = useState(false)
  const [requestMessage, setRequestMessage] = useState('')
  const [isConfirmingPickup, setIsConfirmingPickup] = useState(false)
  const [pickupMessage, setPickupMessage] = useState('')

  // Blocks a second confirm-pickup click fired in the same tick, similar to the
  // submit guard below.
  const isConfirmingPickupRef = useRef(false)

  // Blocks a second submit fired in the same tick (a rapid double-click) before
  // the in-flight state has updated. A ref changes immediately, unlike state, so
  // two clicks in one tick cannot both pass. This pairs with the disabled button
  // (which stops later clicks) and the backend guard (the real duplicate gate).
  const isRequestingRef = useRef(false)

  // The viewer's own claim on this listing, or null when they have not requested
  // it. A member may make only one request per listing, so this is at most one
  // claim. It drives what shows in place of the form: a pending, denied, or
  // approved line. Loaded for non-owners and set straight from the create
  // response after a successful submit. null also means "no request yet", which
  // is when the form shows.
  const latestMyClaimRequestNumber = useRef(0)
  const [myClaim, setMyClaim] = useState<ClaimDecisionResponse | null>(null)

  // Whether the my-claim fetch has finished. It starts false so the page can
  // tell "not loaded yet" apart from "loaded, no request". Without this the
  // request form would flash for a moment on load (myClaim is null at first,
  // which looks like "no request"), then get replaced once the real status
  // arrives. While this is false, the page shows nothing in the request area.
  const [myClaimLoaded, setMyClaimLoaded] = useState(false)

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
    // Clear the request form and the loaded claim so a value, message, or status
    // never carries from one listing (or login) to the next. The in-flight ref is
    // not touched here (a ref cannot be written during render); the submit handler
    // always releases it right after its request finishes.
    setRequestQuantity('')
    setIsRequesting(false)
    setRequestMessage('')
    setMyClaim(null)
    setMyClaimLoaded(false)
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

  // Submit a request for some quantity of this listing. The browser's HTML5
  // validation on the input already blocks an empty, zero, negative, fractional,
  // or too-large value before this runs, but the backend validates again and is
  // the real gate, so a bad value still returns a 422 the catch below shows.
  async function handleRequestSubmit(submitEvent: React.FormEvent<HTMLFormElement>) {
    // Stop the browser's default full-page form submit; this is a single-page app.
    submitEvent.preventDefault()

    // Block a second submit fired in the same tick (a rapid double-click) before
    // the in-flight state below has had a chance to disable the button. The ref
    // updates immediately, so the second click returns here.
    if (isRequestingRef.current === true) {
      return
    }

    // Ask for a final confirmation. A request cannot be changed once made, so the
    // member should be sure. On cancel, do nothing.
    const confirmed = window.confirm(
      'Submit this request? This is final, and you cannot edit or change a request after making it.',
    )
    if (confirmed === false) {
      return
    }

    // Claim the in-flight guard now that the member has confirmed.
    isRequestingRef.current = true

    // Turn the textfield string into a number for the API call.
    const quantityNumber = Number(requestQuantity)

    setIsRequesting(true)
    setRequestMessage('')

    // Remember which load this submit belongs to, to compare after the await, so
    // a response that lands after the user navigated away is dropped.
    const requestNumberAtSubmit = latestRequestNumber.current
    const claimResult = await sendCreateClaimRequest(listingId, memberId, quantityNumber)

    // Release the in-flight guard now the request has finished.
    isRequestingRef.current = false

    if (requestNumberAtSubmit !== latestRequestNumber.current) {
      return
    }

    setIsRequesting(false)

    // Stale login: a 401 means the saved id no longer works. Clear the creds and
    // fall back to logged-out, like the other paths on this page.
    if (claimResult.status === 401) {
      window.localStorage.removeItem('memberId')
      window.localStorage.removeItem('memberName')
      window.localStorage.removeItem('memberEmail')
      setMemberId('')
      setMemberName('')
      window.dispatchEvent(new Event(authStateChangedEventName))
      return
    }

    // Success: store the new claim so the form is replaced by the status line.
    // The create endpoint returns the new claim (status "requested"), the same
    // shape the my-claim fetch loads, so the render path is shared.
    if (claimResult.ok === true) {
      const responseData = claimResult.data as ClaimDecisionResponse
      setMyClaim(responseData)
      setRequestMessage('')
      return
    }

    // Failure, never silent. Prefer a transport error or timeout, then the
    // server's detail text, then a generic line so the message is never empty.
    let failureMessage = 'Could not submit your request. Please try again.'
    if (claimResult.errorMessage !== '') {
      failureMessage = claimResult.errorMessage
    } else if (typeof claimResult.data === 'object' && claimResult.data !== null) {
      const dataObject = claimResult.data as { detail?: unknown }
      if (typeof dataObject.detail === 'string') {
        failureMessage = dataObject.detail
      }
    }
    setRequestMessage(failureMessage)
  }

  async function handleConfirmPickup() {
    if (myClaim === null) {
      return
    }

    if (isConfirmingPickupRef.current === true) {
      return
    }
    isConfirmingPickupRef.current = true

    const confirmed = window.confirm('Confirm that you picked up this item? This cannot be undone.')
    if (confirmed === false) {
      isConfirmingPickupRef.current = false
      return
    }

    setIsConfirmingPickup(true)
    setPickupMessage('')

    const requestNumberAtClick = latestRequestNumber.current
    const claimResult = await sendConfirmPickupRequest(memberId, myClaim.id)

    isConfirmingPickupRef.current = false
    if (requestNumberAtClick !== latestRequestNumber.current) {
      return
    }

    setIsConfirmingPickup(false)

    if (claimResult.status === 401) {
      window.localStorage.removeItem('memberId')
      window.localStorage.removeItem('memberName')
      window.localStorage.removeItem('memberEmail')
      setMemberId('')
      setMemberName('')
      window.dispatchEvent(new Event(authStateChangedEventName))
      return
    }

    if (claimResult.ok === true) {
      setMyClaim(claimResult.data as ClaimDecisionResponse)
      setPickupMessage('')
      return
    }

    let failureMessage = 'Could not confirm pickup. Please try again.'
    if (claimResult.errorMessage !== '') {
      failureMessage = claimResult.errorMessage
    } else if (typeof claimResult.data === 'object' && claimResult.data !== null) {
      const dataObject = claimResult.data as { detail?: unknown }
      if (typeof dataObject.detail === 'string') {
        failureMessage = dataObject.detail
      }
    }
    setPickupMessage(failureMessage)
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
  // The mirror image: the listing has loaded and the viewer is NOT its owner.
  // This drives the request form and the viewer's own-claim status fetch below.
  const viewerIsNonOwnerOfLoaded =
    loadedListingId !== '' && loadedOwnerId !== '' && loadedOwnerId !== memberId

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

  // For a non-owner viewer, load their own claim on this listing (if any) so the
  // page can show their request status, even after a reload. Its own stale-
  // response ref keeps a late answer from disturbing the other fetches. A
  // successful submit sets myClaim directly, so this only runs on a listing or
  // member change, never overwriting a just-made request.
  useEffect(() => {
    latestMyClaimRequestNumber.current = latestMyClaimRequestNumber.current + 1
    if (viewerIsNonOwnerOfLoaded === false) {
      // The form and status only show for a non-owner, so an owner view needs no
      // fetch (the render-time reset above already cleared any prior claim).
      return
    }
    const requestNumber = latestMyClaimRequestNumber.current
    async function loadMyClaim() {
      const claimResult = await sendGetMyClaimRequest(loadedListingId, memberId)
      if (requestNumber !== latestMyClaimRequestNumber.current) {
        return
      }
      if (claimResult.status === 401) {
        // Same stale-session handling as the other fetches on this page.
        window.localStorage.removeItem('memberId')
        window.localStorage.removeItem('memberName')
        window.localStorage.removeItem('memberEmail')
        setMemberId('')
        setMemberName('')
        window.dispatchEvent(new Event(authStateChangedEventName))
        return
      }
      if (claimResult.ok === false) {
        // On any failure, fall back to the form (no known claim), and mark the
        // check done so the loading line gives way.
        setMyClaim(null)
        setMyClaimLoaded(true)
        return
      }
      // The body is the claim object, or null when the viewer has not requested
      // this listing. A null (or non-object) body means show the form.
      if (claimResult.data !== null && typeof claimResult.data === 'object') {
        setMyClaim(claimResult.data as ClaimDecisionResponse)
      } else {
        setMyClaim(null)
      }
      setMyClaimLoaded(true)
    }
    loadMyClaim()
  }, [viewerIsNonOwnerOfLoaded, loadedListingId, memberId])

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
    // The non-owner request area. What it shows depends on the viewer's own claim
    // on this listing:
    //   - no claim yet: the quantity textfield and Submit button.
    //   - requested (pending): "You requested X quantity on: Y".
    //   - denied: a short line saying the request was denied.
    //   - approved: the approved quantity and time, plus a link to invite the
    //     member to the Exchange Thread (a feature not built yet, stubbed below).
    //   - withdrawn: a short line; the member already requested, so no new form.
    // The form uses native HTML5 validation only (whole numbers via step, at
    // least 1 via min, no more than the remaining quantity via max, required), so
    // no custom JavaScript checks the value. The backend validates again and is
    // the real gate; a value that slips past the browser comes back as a 422
    // whose message shows in the alert below.
    let requestArea = null
    let requestMessageArea = null
    if (memberId !== ownerId) {
      if (myClaimLoaded === false) {
        // The claim status is still loading. Show nothing yet (not the form and
        // no placeholder text), so the form does not flash before an existing
        // request's status replaces it. requestArea stays null.
        requestArea = null
      } else if (myClaim === null) {
        // No request made yet, so show the form.
        requestArea = (
          <form onSubmit={handleRequestSubmit}>
            <label>
              Request quantity:{' '}
              <input
                type="number"
                min="1"
                max={listing.remaining_quantity}
                step="1"
                required
                value={requestQuantity}
                onChange={(changeEvent) => setRequestQuantity(changeEvent.target.value)}
              />
            </label>{' '}
            <button type="submit" disabled={isRequesting}>
              Submit
            </button>
          </form>
        )
        // The failure line, announced with role="alert".
        if (requestMessage !== '') {
          requestMessageArea = <p role="alert">{requestMessage}</p>
        }
      } else if (myClaim.status === 'requested') {
        // The request is in, waiting on the owner. Show the pending line.
        const requestedAtText = formatTimestamp(myClaim.requested_at)
        requestArea = (
          <p>
            You requested {myClaim.requested_quantity} quantity on: {requestedAtText}
          </p>
        )
      } else if (myClaim.status === 'denied') {
        // Denied. The spec asks for a plain "was denied" line, nothing more.
        requestArea = <p>Your request was denied.</p>
      } else if (myClaim.status === 'approved') {
        // Approved. Show the approved quantity and when, plus the Exchange Thread
        // link and a confirm pickup action.
        let approvedQuantity = 0
        if (myClaim.approved_quantity !== null) {
          approvedQuantity = myClaim.approved_quantity
        }
        let approvedAtValue = ''
        if (myClaim.approved_at !== null) {
          approvedAtValue = myClaim.approved_at
        }
        const approvedAtText = formatTimestamp(approvedAtValue)
        // Stub: the Exchange Thread feature is not built yet, so this link points
        // at a placeholder route for now.
        const exchangeThreadTarget = '/exchange-thread?claim=' + myClaim.id
        requestArea = (
          <>
            <p>
              Your request was approved for {approvedQuantity} on: {approvedAtText}.
            </p>
            <p>
              <Link to={exchangeThreadTarget}>Arrange the Exchange</Link>
            </p>
            <p>
              <button type="button" disabled={isConfirmingPickup} onClick={handleConfirmPickup}>
                Confirm pickup
              </button>
            </p>
            {pickupMessage !== '' ? <p role="alert">{pickupMessage}</p> : null}
          </>
        )
      } else if (myClaim.status === 'picked_up') {
        let pickedUpAtValue = ''
        if (myClaim.picked_up_at !== null) {
          pickedUpAtValue = myClaim.picked_up_at
        }
        const pickedUpAtText = formatTimestamp(pickedUpAtValue)
        const exchangeThreadTarget = '/exchange-thread?claim=' + myClaim.id
        requestArea = (
          <>
            <p>Your pickup was confirmed on: {pickedUpAtText}.</p>
            <p>
              <Link to={exchangeThreadTarget}>Contact the Provider</Link>
            </p>
          </>
        )
      } else {
        // A withdrawn (cancelled) request. The member already requested this
        // listing, so the backend will not accept another; show a short line
        // instead of the form.
        requestArea = <p>You withdrew your request.</p>
      }
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
        {requestArea}
        {requestMessageArea}
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
