import { useEffect, useRef, useState } from 'react'

import { sendGetMyRequestsRequest } from '../services/requestQueueService'
import type {
  ListingQueueGroup,
  RequestQueuesResponse,
  RequestQueuesResult,
} from '../services/requestQueueService'
import { authStateChangedEventName } from '../services/authService'
import { formatTimestamp, getLocalTimeZoneNote } from '../utils/formatTimestamp'

// One shared message for the not-logged-in case, declared at module scope so the
// wording is the same everywhere and it is not a useEffect dependency.
const notLoggedInMessage = 'You need to be logged in to see this page.'

// The outgoing view: the requests the logged-in member has made on other
// members' listings. It mirrors RequestQueuesPage (the incoming view) in its
// listing-title format, oldest-first rows with timestamps, the local time-zone
// note, and the newest-listing-first group order, but it has no listing filter.
function MyRequestsPage() {
  // Counts loads so an older response cannot overwrite a newer one (for example
  // after a stale session is cleared).
  const latestRequestNumber = useRef(0)

  // memberId is the auth truth: logged in means it is not empty. It lives in
  // state so a stale-session 401 can flip the page to logged-out without a
  // reload, the same as the incoming-requests page.
  const [memberId, setMemberId] = useState(window.localStorage.getItem('memberId') ?? '')

  // Holds the whole response. null means it has not loaded yet, which doubles as
  // the loading state.
  const [result, setResult] = useState<RequestQueuesResult | null>(null)

  // Load the caller's outgoing requests when the page has a logged-in member.
  useEffect(() => {
    latestRequestNumber.current = latestRequestNumber.current + 1
    if (memberId === '') {
      return
    }
    const requestNumber = latestRequestNumber.current
    async function loadMyRequests() {
      const loadedResult = await sendGetMyRequestsRequest(memberId)
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
    loadMyRequests()
  }, [memberId])

  // Build the markup for one listing's group: the title (with a "(deactivated)"
  // suffix when the listing is deactivated), the remaining quantity, and the
  // caller's request row with its timestamp. Same format as the incoming view.
  function buildGroupView(group: ListingQueueGroup) {
    let titleText = group.listing_title
    if (group.listing_status === 'deactivated') {
      titleText = group.listing_title + ' (deactivated)'
    }
    const rowItems = []
    for (let index = 0; index < group.pending.length; index = index + 1) {
      const item = group.pending[index]
      const requestedAtText = formatTimestamp(item.requested_at)
      rowItems.push(
        <li key={item.id}>
          You requested {item.requested_quantity} ({requestedAtText})
        </li>,
      )
    }
    return (
      <article key={group.listing_id}>
        <h2>{titleText}</h2>
        <p>Remaining quantity: {group.remaining_quantity}</p>
        <ul>{rowItems}</ul>
      </article>
    )
  }

  // The note that tells the viewer the request times are in their local zone.
  const timeZoneNote = getLocalTimeZoneNote()

  // Build the content area with a plain if/else chain, checked in a set order.
  let contentArea
  if (memberId === '') {
    contentArea = <p role="alert">{notLoggedInMessage}</p>
  } else if (result === null) {
    contentArea = <p>Loading your requests...</p>
  } else if (result.errorMessage !== '') {
    contentArea = <p role="alert">{result.errorMessage}</p>
  } else if (result.ok) {
    const responseData = result.data as RequestQueuesResponse
    const groups = responseData.groups
    if (groups.length === 0) {
      contentArea = <p>You have not made any requests yet.</p>
    } else {
      const groupViews = []
      for (let index = 0; index < groups.length; index = index + 1) {
        groupViews.push(buildGroupView(groups[index]))
      }
      contentArea = (
        <>
          <div>{groupViews}</div>
          <p>
            <small>{timeZoneNote}</small>
          </p>
        </>
      )
    }
  } else {
    let detailMessage = 'Could not load your requests. Please try again.'
    if (typeof result.data === 'object' && result.data !== null) {
      const dataObject = result.data as { detail?: unknown }
      if (typeof dataObject.detail === 'string') {
        detailMessage = dataObject.detail
      }
    }
    contentArea = <p role="alert">{detailMessage}</p>
  }

  return (
    <section>
      <h1>Requests you have made</h1>
      {contentArea}
    </section>
  )
}

export default MyRequestsPage
