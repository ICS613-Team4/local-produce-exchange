import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { sendBrowseListingsRequest } from '../services/listingService'
import type { ListingDetail, ListingResult } from '../services/listingService'
import { sendGetRequestQueuesRequest } from '../services/requestQueueService'
import type { RequestQueuesResponse, RequestQueuesResult } from '../services/requestQueueService'
import { authStateChangedEventName } from '../services/authService'
import { formatTimestamp, getLocalTimeZoneNote } from '../utils/formatTimestamp'

// One flattened pending request, pulled out of its listing group so the widget
// can sort across every listing and show the newest few.
type LatestRequestRow = {
  id: string
  claimant_name: string
  listing_title: string
  requested_quantity: number
  requested_at: string
}

// Sort newest first: a later requested_at sorts before an earlier one. An
// explicit comparison keeps this readable instead of a one-line trick.
function compareByRequestedAtDescending(rowA: LatestRequestRow, rowB: LatestRequestRow) {
  const timeA = new Date(rowA.requested_at).getTime()
  const timeB = new Date(rowB.requested_at).getTime()
  if (timeA < timeB) {
    return 1
  }
  if (timeA > timeB) {
    return -1
  }
  return 0
}

function DashboardPage() {
  // memberId lives in state so a stale-session 401 on the queue fetch can flip
  // the page to logged-out on the current render. An empty value means nobody is
  // logged in, so both fetches below are skipped.
  const [memberId, setMemberId] = useState(window.localStorage.getItem('memberId') ?? '')

  // Holds the preview response (the five newest active listings). null means it
  // has not loaded yet.
  const [previewResult, setPreviewResult] = useState<ListingResult | null>(null)

  // Holds the latest-requests response. null means it has not loaded yet. The
  // queue fetch keeps its own stale-response ref because this page already has
  // the preview fetch.
  const latestQueueRequestNumber = useRef(0)
  const [queueResult, setQueueResult] = useState<RequestQueuesResult | null>(null)

  // Load a small preview of the five newest active listings when logged in.
  useEffect(() => {
    if (memberId === '') {
      return
    }
    async function loadPreview() {
      const loadedResult = await sendBrowseListingsRequest(memberId, { limit: 5 })
      setPreviewResult(loadedResult)
    }
    loadPreview()
  }, [memberId])

  // Load the poster's incoming pending requests across all their listings. Its
  // own stale-response ref keeps an older response from overwriting a newer one.
  useEffect(() => {
    latestQueueRequestNumber.current = latestQueueRequestNumber.current + 1
    if (memberId === '') {
      return
    }
    const requestNumber = latestQueueRequestNumber.current
    async function loadQueue() {
      const loadedResult = await sendGetRequestQueuesRequest(memberId, '')
      if (requestNumber !== latestQueueRequestNumber.current) {
        return
      }
      if (loadedResult.status === 401) {
        // The saved memberId no longer works. Clear the stale credentials like
        // logout, so the nav and the page fall back to the logged-out view.
        window.localStorage.removeItem('memberId')
        window.localStorage.removeItem('memberName')
        window.localStorage.removeItem('memberEmail')
        setMemberId('')
        window.dispatchEvent(new Event(authStateChangedEventName))
        return
      }
      setQueueResult(loadedResult)
    }
    loadQueue()
  }, [memberId])

  // Build the preview area with a plain if/else chain, checked in a set order.
  // The note that tells the viewer the times on this page are in their local zone.
  const timeZoneNote = getLocalTimeZoneNote()

  let previewArea
  if (memberId === '') {
    previewArea = null
  } else if (previewResult === null) {
    previewArea = <p>Loading latest listings...</p>
  } else if (previewResult.errorMessage !== '') {
    previewArea = <p role="alert">{previewResult.errorMessage}</p>
  } else if (previewResult.ok) {
    const listings = previewResult.data as ListingDetail[]
    if (listings.length === 0) {
      previewArea = <p>No listings yet.</p>
    } else {
      const previewItems = []
      for (let index = 0; index < listings.length; index = index + 1) {
        const listing = listings[index]
        const postedText = formatTimestamp(listing.created_at)
        previewItems.push(
          <li key={listing.id}>
            <Link to={'/listings/' + listing.id}>{listing.title}</Link> ({postedText})
          </li>,
        )
      }
      previewArea = (
        <>
          <ul>{previewItems}</ul>
          <p>
            <small>{timeZoneNote}</small>
          </p>
        </>
      )
    }
  } else {
    previewArea = <p role="alert">Could not load the latest listings.</p>
  }

  // Build the latest-requests widget with its own if/else chain. A failure here
  // shows a short line and leaves the listings preview above untouched.
  let requestsWidgetArea
  if (memberId === '') {
    requestsWidgetArea = null
  } else if (queueResult === null) {
    requestsWidgetArea = <p>Loading latest requests...</p>
  } else if (queueResult.errorMessage !== '') {
    requestsWidgetArea = <p role="alert">{queueResult.errorMessage}</p>
  } else if (queueResult.ok) {
    // Flatten every group's pending rows into one list, carrying the listing
    // title, then sort newest-first and keep the first five.
    const responseData = queueResult.data as RequestQueuesResponse
    const groups = responseData.groups
    const flatRows: LatestRequestRow[] = []
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex = groupIndex + 1) {
      const group = groups[groupIndex]
      for (let itemIndex = 0; itemIndex < group.pending.length; itemIndex = itemIndex + 1) {
        const item = group.pending[itemIndex]
        const row = {
          id: item.id,
          claimant_name: item.claimant_name,
          listing_title: group.listing_title,
          requested_quantity: item.requested_quantity,
          requested_at: item.requested_at,
        }
        flatRows.push(row)
      }
    }
    flatRows.sort(compareByRequestedAtDescending)
    const newestRows = []
    for (let index = 0; index < flatRows.length && index < 5; index = index + 1) {
      newestRows.push(flatRows[index])
    }

    if (newestRows.length === 0) {
      requestsWidgetArea = <p>No pending requests yet.</p>
    } else {
      const rowItems = []
      for (let index = 0; index < newestRows.length; index = index + 1) {
        const row = newestRows[index]
        const requestedAtText = formatTimestamp(row.requested_at)
        rowItems.push(
          <li key={row.id}>
            {row.claimant_name} requested {row.requested_quantity} on {row.listing_title} (
            {requestedAtText})
          </li>,
        )
      }
      requestsWidgetArea = (
        <>
          <ul>{rowItems}</ul>
          <p>
            <small>{timeZoneNote}</small>
          </p>
        </>
      )
    }
  } else {
    // A non-200 HTTP failure. Show the server's detail text, or a short fallback.
    let widgetError = 'Could not load your latest requests.'
    if (typeof queueResult.data === 'object' && queueResult.data !== null) {
      const dataObject = queueResult.data as { detail?: unknown }
      if (typeof dataObject.detail === 'string') {
        widgetError = dataObject.detail
      }
    }
    requestsWidgetArea = <p role="alert">{widgetError}</p>
  }

  return (
    <section>
      <h1>Member Dashboard</h1>
      <ul>
        <li>
          <Link to="/browse">Browse All Listings</Link>
        </li>
        <li>
          <Link to="/listings/create">Create a Listing</Link>
        </li>
        <li>
          <Link to="/invite">Invite a New Member</Link>
        </li>
        <li>
          <Link to="/profile">View Your Profile</Link>
        </li>
        <li>
          <Link to="/requests">See All Requests from Other Members</Link>
        </li>
        <li>
          <Link to="/my-requests">See All Your Requests</Link>
        </li>
      </ul>
      <section>
        <h2>Latest Community Listings</h2>
        {previewArea}
      </section>
      <section>
        <h2>Latest Requests from Other Members</h2>
        {requestsWidgetArea}
      </section>
    </section>
  )
}

export default DashboardPage
