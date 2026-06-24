import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import { sendGetRequestQueuesRequest } from '../services/requestQueueService'
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

function RequestQueuesPage() {
  // Counts queue loads so an older response cannot overwrite a newer one (for
  // example after the listing filter changes or a stale session is cleared).
  const latestRequestNumber = useRef(0)

  // The optional ?listing=<id> filter. Empty means show every queue; a value
  // means show only that one listing's queue (the backend checks ownership).
  const [searchParams] = useSearchParams()
  const listingFilter = searchParams.get('listing') ?? ''

  // memberId is the auth truth: logged in means it is not empty. It lives in
  // state so a stale-session 401 can flip the page to logged-out without a
  // reload, the same as ListingDetailPage.
  const [memberId, setMemberId] = useState(window.localStorage.getItem('memberId') ?? '')

  // Holds the whole response. null means it has not loaded yet, which doubles as
  // the loading state. resultFilter records which filter the held result was
  // loaded for, so a filter change shows "Loading" instead of the old filter's
  // data for one frame.
  const [result, setResult] = useState<RequestQueuesResult | null>(null)
  const [resultFilter, setResultFilter] = useState('')

  // Load the queues when the page has a logged-in member. The request number
  // keeps an older response from replacing a newer load.
  useEffect(() => {
    latestRequestNumber.current = latestRequestNumber.current + 1
    if (memberId === '') {
      return
    }
    const requestNumber = latestRequestNumber.current
    async function loadQueues() {
      const loadedResult = await sendGetRequestQueuesRequest(memberId, listingFilter)
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
        // The route is not changing, so tell the shared nav the login was
        // cleared by firing the same-tab event it listens for.
        window.dispatchEvent(new Event(authStateChangedEventName))
        return
      }
      setResult(loadedResult)
      setResultFilter(listingFilter)
    }
    loadQueues()
  }, [memberId, listingFilter])

  // Build the markup for one listing's queue: the title (with a "(deactivated)"
  // suffix when the listing is deactivated), the remaining quantity, and the
  // pending rows oldest-first.
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
          {item.claimant_name} requested {item.requested_quantity} ({requestedAtText})
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
    // A logged-out viewer cannot load queues. This also covers the just-cleared
    // 401 case above.
    contentArea = <p role="alert">{notLoggedInMessage}</p>
  } else if (result === null || resultFilter !== listingFilter) {
    // First render, or a filter change before the next response arrives.
    contentArea = <p>Loading your requests...</p>
  } else if (result.errorMessage !== '') {
    // A transport failure (timeout or network error); the service returns this
    // with status 0, so check it before the HTTP-status branches.
    contentArea = <p role="alert">{result.errorMessage}</p>
  } else if (result.ok) {
    // The backend owns this shape, so read the body with one plain cast.
    const responseData = result.data as RequestQueuesResponse
    const groups = responseData.groups
    if (listingFilter !== '') {
      // Filtered view: show only the group whose listing matches the filter. The
      // backend already scopes to that one listing, so the response is either
      // that single group or empty.
      let matchingGroup = null
      for (let index = 0; index < groups.length; index = index + 1) {
        if (groups[index].listing_id === listingFilter) {
          matchingGroup = groups[index]
        }
      }
      if (matchingGroup === null) {
        contentArea = <p>No pending requests on this listing yet.</p>
      } else {
        contentArea = (
          <>
            {buildGroupView(matchingGroup)}
            <p>
              <small>{timeZoneNote}</small>
            </p>
          </>
        )
      }
    } else if (groups.length === 0) {
      // No filter and nothing pending anywhere: one global empty message.
      contentArea = <p>You have no pending requests on any of your listings.</p>
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
    // Any HTTP failure (for example the 403 foreign-listing case, or a 503).
    // Show the server's detail text, falling back to a plain line so the message
    // is never blank. The backend details are already written in plain words.
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
      <h1>Requests from other members</h1>
      {contentArea}
    </section>
  )
}

export default RequestQueuesPage
