import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'

import { sendGetListingRequest } from '../services/listingService'
import type { ListingDetail, ListingResult } from '../services/listingService'
import { sendLogoutRequest } from '../services/authService'
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

  async function handleLogout() {
    await sendLogoutRequest()
    window.localStorage.removeItem('memberId')
    window.localStorage.removeItem('memberName')
    window.localStorage.removeItem('memberEmail')
    // Reset both: the nav gates on memberId and the line reads memberName.
    setMemberId('')
    setMemberName('')
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
        return
      }
      setResult(loadedResult)
      setResultListingId(listingId)
    }
    loadListing()
  }, [listingId, memberId])

  // Build the login-aware navigation area, always shown. Both branches assign,
  // so it is declared without an initial value (the same shape HomePage uses).
  let loggedInArea
  if (memberId !== '') {
    let loggedInLine = 'Logged in.'
    if (memberName !== '') {
      loggedInLine = 'Logged in as ' + memberName + '.'
    }
    loggedInArea = (
      <>
        <p>{loggedInLine}</p>
        <p>
          <Link to="/dashboard">Go to dashboard</Link>
        </p>
        <p>
          <button onClick={handleLogout}>Log out</button>
        </p>
      </>
    )
  } else {
    loggedInArea = (
      <p>
        <Link to="/login">Go to login page</Link>
      </p>
    )
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
    // Spell out, in plain words, that the times above are in the viewer's own
    // local zone, the way calendar and event sites do. We add the IANA zone
    // name (like "Pacific/Honolulu") when the browser can report it.
    const localTimeZoneName = getLocalTimeZoneName()
    let timeZoneNote = 'All times are shown in your local time zone.'
    if (localTimeZoneName !== '') {
      timeZoneNote = 'All times are shown in your local time zone (' + localTimeZoneName + ').'
    }
    let editArea = null
    if (memberId === ownerId) {
      editArea = (
        <p>
          <Link to={'/listings/' + listing.id + '/edit'}>Edit listing</Link>
        </p>
      )
    }
    // Quantity available (what the poster entered) and remaining quantity (what
    // is left) are two different numbers, so label each on its own line.
    contentArea = (
      <>
        <h2>{listing.title}</h2>
        <p>{listing.description}</p>
        <p>Category: {listing.category}</p>
        <p>Quantity available: {listing.total_quantity}</p>
        <p>Remaining quantity: {listing.remaining_quantity}</p>
        <p>Dietary tags: {dietaryText}</p>
        <p>Allergen tags: {allergenText}</p>
        <p>Pickup start: {pickupStartText}</p>
        <p>Pickup end: {pickupEndText}</p>
        <p>
          <small>{timeZoneNote}</small>
        </p>
        {editArea}
      </>
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
    <>
      <h1>Listing details</h1>
      <p>
        <Link to="/">Go to home page</Link>
      </p>
      <p>
        <Link to="/about">Go to about page</Link>
      </p>
      {loggedInArea}
      {contentArea}
    </>
  )
}

export default ListingDetailPage
