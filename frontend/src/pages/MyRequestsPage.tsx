import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { sendGetMyRequestsRequest } from '../services/requestQueueService'
import type {
  MyRequestItem,
  MyRequestsResponse,
  RequestQueuesResult,
} from '../services/requestQueueService'
import { authStateChangedEventName } from '../services/authService'
import { formatTimestamp, getLocalTimeZoneNote } from '../utils/formatTimestamp'

// One shared message for the not-logged-in case, declared at module scope so the
// wording is the same everywhere and it is not a useEffect dependency.
const notLoggedInMessage = 'You need to be logged in to see this page.'

// The outgoing view: the requests the logged-in member has made on other
// members' listings, split into three sections (Pending, Approved, Denied). Each
// section is newest-first, the order the backend already returns.
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

  // Build the row text for one request. Each section shows the listing title, the
  // quantity that matters for that state, and the time it entered that state.
  function buildRequestRow(item: MyRequestItem) {
    if (item.status === 'approved') {
      // Show the approved quantity (a partial approval can be less than asked)
      // and when it was approved.
      let approvedQuantity = 0
      if (item.approved_quantity !== null) {
        approvedQuantity = item.approved_quantity
      }
      let approvedAtText = ''
      if (item.approved_at !== null) {
        approvedAtText = formatTimestamp(item.approved_at)
      }
      // Stub link to the (not-built) Exchange Thread feature, the same one the
      // listing detail page shows on an approved request.
      const exchangeThreadTarget = '/exchange-thread?claim=' + item.id
      return (
        <li key={item.id}>
          {item.listing_title}: You were approved for: {approvedQuantity} on {approvedAtText}{' '}
          <Link to={exchangeThreadTarget}>Arrange the Exchange</Link>
        </li>
      )
    }
    if (item.status === 'denied') {
      let deniedAtText = ''
      if (item.denied_at !== null) {
        deniedAtText = formatTimestamp(item.denied_at)
      }
      return (
        <li key={item.id}>
          {item.listing_title}: Your request for {item.requested_quantity} was denied on:{' '}
          {deniedAtText}
        </li>
      )
    }
    // Pending.
    const requestedAtText = formatTimestamp(item.requested_at)
    return (
      <li key={item.id}>
        {item.listing_title}: You requested {item.requested_quantity} on {requestedAtText}
      </li>
    )
  }

  // Build one section: its heading, then either the rows or a short empty line.
  function buildSection(heading: string, items: MyRequestItem[], emptyText: string) {
    let body
    if (items.length === 0) {
      body = <p>{emptyText}</p>
    } else {
      const rows = []
      for (let index = 0; index < items.length; index = index + 1) {
        rows.push(buildRequestRow(items[index]))
      }
      body = <ul>{rows}</ul>
    }
    return (
      <section>
        <h2>{heading}</h2>
        {body}
      </section>
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
    const responseData = result.data as MyRequestsResponse
    const pendingSection = buildSection(
      'Pending',
      responseData.pending,
      'You have no pending requests.',
    )
    const approvedSection = buildSection(
      'Approved',
      responseData.approved,
      'You have no approved requests.',
    )
    const deniedSection = buildSection(
      'Denied',
      responseData.denied,
      'You have no denied requests.',
    )
    contentArea = (
      <>
        {pendingSection}
        <hr />
        {approvedSection}
        <hr />
        {deniedSection}
        <p>
          <small>{timeZoneNote}</small>
        </p>
      </>
    )
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
