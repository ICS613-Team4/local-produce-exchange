import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { sendBrowseListingsRequest, sendGetMyListingsRequest } from '../services/listingService'
import type { ListingDetail, ListingResult } from '../services/listingService'
import {
  sendDecideClaimRequest,
  sendGetMyRequestsRequest,
  sendGetRequestQueuesRequest,
  sendWithdrawClaimRequest,
} from '../services/requestQueueService'
import type {
  ListingQueueGroup,
  MyRequestsResponse,
  RequestQueuesResponse,
  RequestQueuesResult,
} from '../services/requestQueueService'
import { formatTimestamp, getLocalTimeZoneNote } from '../utils/formatTimestamp'

function DashboardPage() {
  // The logged-in member id, read once from localStorage. The route is under
  // RequireAuth, which already validated the member, so this page uses simple
  // error handling, not the 401 cred-clearing state machine. An empty value
  // means nobody is logged in, so every fetch below is skipped.
  const memberId = window.localStorage.getItem('memberId') ?? ''

  // Each section holds its own response. null means it has not loaded yet, which
  // doubles as that section's loading state. Each section loads on its own, so
  // one section failing does not blank the others.
  const [previewResult, setPreviewResult] = useState<ListingResult | null>(null)
  const [myListingsResult, setMyListingsResult] = useState<ListingResult | null>(null)
  const [incomingResult, setIncomingResult] = useState<RequestQueuesResult | null>(null)
  const [outgoingResult, setOutgoingResult] = useState<RequestQueuesResult | null>(null)

  // Bumped after a decision or a withdraw to re-run the matching load effect, so
  // the decided/withdrawn row drops out and the remaining quantity updates.
  const [incomingReload, setIncomingReload] = useState(0)
  const [outgoingReload, setOutgoingReload] = useState(0)

  // The claim id whose decision or withdraw is in flight, so only that row's
  // buttons are greyed while it runs.
  const [decidingClaimId, setDecidingClaimId] = useState('')
  const [withdrawingClaimId, setWithdrawingClaimId] = useState('')

  // Same-tick double-click guards, holding the claim id in flight, like the
  // ListingDetailPage and RequestQueuesPage handlers.
  const decisionInFlightRef = useRef('')
  const withdrawInFlightRef = useRef('')

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

  // Load the caller's own listings for the My Active Listings section.
  useEffect(() => {
    if (memberId === '') {
      return
    }
    async function loadMyListings() {
      const loadedResult = await sendGetMyListingsRequest(memberId)
      setMyListingsResult(loadedResult)
    }
    loadMyListings()
  }, [memberId])

  // Load the live incoming-request queue (pending requests on the caller's
  // listings). Reloads after a decision so the decided row drops out.
  useEffect(() => {
    if (memberId === '') {
      return
    }
    async function loadIncoming() {
      const loadedResult = await sendGetRequestQueuesRequest(memberId, '')
      setIncomingResult(loadedResult)
    }
    loadIncoming()
  }, [memberId, incomingReload])

  // Load the caller's own outgoing requests. Reloads after a withdraw so the
  // withdrawn row drops out.
  useEffect(() => {
    if (memberId === '') {
      return
    }
    async function loadOutgoing() {
      const loadedResult = await sendGetMyRequestsRequest(memberId)
      setOutgoingResult(loadedResult)
    }
    loadOutgoing()
  }, [memberId, outgoingReload])

  // Approve or deny one pending request from the live queue. Confirms, guards
  // against a double-click, calls the decide endpoint, then on success reloads
  // the incoming queue. The backend stays the real permission gate.
  async function handleDecision(claimId: string, decision: string) {
    if (decisionInFlightRef.current === claimId) {
      return
    }
    decisionInFlightRef.current = claimId

    let confirmMessage = 'Approve this request? This is final.'
    if (decision === 'deny') {
      confirmMessage = 'Deny this request? This is final.'
    }
    const confirmed = window.confirm(confirmMessage)
    if (confirmed === false) {
      if (decisionInFlightRef.current === claimId) {
        decisionInFlightRef.current = ''
      }
      return
    }

    setDecidingClaimId(claimId)

    const decisionResult = await sendDecideClaimRequest(memberId, claimId, decision)

    if (decisionInFlightRef.current === claimId) {
      decisionInFlightRef.current = ''
    }
    setDecidingClaimId('')

    // A timeout or network failure comes back with status 0 and a message.
    if (decisionResult.errorMessage !== '') {
      window.alert(decisionResult.errorMessage)
      return
    }

    // Any HTTP failure (for example a 403 non-owner or a 409 already-decided).
    if (decisionResult.ok === false) {
      let detailMessage = 'Could not update the request. Please try again.'
      if (typeof decisionResult.data === 'object' && decisionResult.data !== null) {
        const dataObject = decisionResult.data as { detail?: unknown }
        if (typeof dataObject.detail === 'string') {
          detailMessage = dataObject.detail
        }
      }
      window.alert(detailMessage)
      return
    }

    // Success: reload the queue so the decided row drops out and the remaining
    // quantity reflects the backend value.
    setIncomingReload((currentValue) => currentValue + 1)
  }

  // Withdraw one of the caller's own pending requests. Same shape as
  // handleDecision, but it acts as the requester, not the listing owner.
  async function handleWithdraw(claimId: string) {
    if (withdrawInFlightRef.current === claimId) {
      return
    }
    withdrawInFlightRef.current = claimId

    const confirmed = window.confirm('Withdraw this request? It will leave the queue.')
    if (confirmed === false) {
      if (withdrawInFlightRef.current === claimId) {
        withdrawInFlightRef.current = ''
      }
      return
    }

    setWithdrawingClaimId(claimId)

    const withdrawResult = await sendWithdrawClaimRequest(memberId, claimId)

    if (withdrawInFlightRef.current === claimId) {
      withdrawInFlightRef.current = ''
    }
    setWithdrawingClaimId('')

    if (withdrawResult.errorMessage !== '') {
      window.alert(withdrawResult.errorMessage)
      return
    }

    if (withdrawResult.ok === false) {
      let detailMessage = 'Could not withdraw the request. Please try again.'
      if (typeof withdrawResult.data === 'object' && withdrawResult.data !== null) {
        const dataObject = withdrawResult.data as { detail?: unknown }
        if (typeof dataObject.detail === 'string') {
          detailMessage = dataObject.detail
        }
      }
      window.alert(detailMessage)
      return
    }

    setOutgoingReload((currentValue) => currentValue + 1)
  }

  // The note that tells the viewer the times on this page are in their local zone.
  const timeZoneNote = getLocalTimeZoneNote()

  // --- Latest Community Listings preview (unchanged from before) -------------
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
            <Link to={'/listings/' + listing.id}>{listing.title}</Link> (posted on: {postedText})
          </li>,
        )
      }
      previewArea = <ul>{previewItems}</ul>
    }
  } else {
    previewArea = <p role="alert">Could not load the latest listings.</p>
  }

  // --- My Active Listings section -------------------------------------------
  let myActiveArea
  if (myListingsResult === null) {
    myActiveArea = <p>Loading your active listings...</p>
  } else if (myListingsResult.errorMessage !== '') {
    myActiveArea = <p role="alert">{myListingsResult.errorMessage}</p>
  } else if (myListingsResult.ok) {
    const listings = myListingsResult.data as ListingDetail[]
    const activeRows = []
    for (let index = 0; index < listings.length; index = index + 1) {
      const listing = listings[index]
      if (listing.status !== 'active') {
        continue
      }
      const postedText = formatTimestamp(listing.created_at)
      activeRows.push(
        <li key={listing.id}>
          <Link to={'/listings/' + listing.id}>{listing.title}</Link> (posted on: {postedText}) -{' '}
          {listing.remaining_quantity} remaining
        </li>,
      )
    }
    if (activeRows.length === 0) {
      myActiveArea = (
        <>
          <p>You have no active listings.</p>
          <p>
            <Link to="/my-listings">See All My Listings</Link>
          </p>
        </>
      )
    } else {
      myActiveArea = (
        <>
          <ul>{activeRows}</ul>
          <p>
            <Link to="/my-listings">See All My Listings</Link>
          </p>
        </>
      )
    }
  } else {
    myActiveArea = <p role="alert">Could not load your active listings.</p>
  }

  function buildIncomingGroup(group: ListingQueueGroup) {
    let titleText = group.listing_title
    if (group.listing_status === 'deactivated') {
      titleText = group.listing_title + ' (deactivated)'
    }
    const rowItems = []
    for (let index = 0; index < group.pending.length; index = index + 1) {
      const item = group.pending[index]
      const requestedAtText = formatTimestamp(item.requested_at)
      const isThisRowPending = decidingClaimId === item.id

      // Approve and Deny are shown independently. Approve needs remaining stock
      // (can_decide); Deny does not (can_deny), so an exhausted-but-active listing
      // still lets the owner clear a pending request.
      let approveButton = null
      if (item.can_decide === true) {
        approveButton = (
          <>
            {' '}
            <button
              type="button"
              disabled={isThisRowPending}
              onClick={() => handleDecision(item.id, 'approve')}
            >
              Approve
            </button>
          </>
        )
      }
      let denyButton = null
      if (item.can_deny === true) {
        denyButton = (
          <>
            {' '}
            <button
              type="button"
              disabled={isThisRowPending}
              onClick={() => handleDecision(item.id, 'deny')}
            >
              Deny
            </button>
          </>
        )
      }
      rowItems.push(
        <li key={item.id}>
          {item.claimant_name} requested {item.requested_quantity} ({requestedAtText})
          {approveButton}
          {denyButton}
        </li>,
      )
    }
    return (
      <article key={group.listing_id}>
        <h3>{titleText}</h3>
        <ul>{rowItems}</ul>
      </article>
    )
  }

  // --- Incoming requests section --------------------------------------------
  let incomingArea
  if (incomingResult === null) {
    incomingArea = <p>Loading incoming requests...</p>
  } else if (incomingResult.errorMessage !== '') {
    incomingArea = <p role="alert">{incomingResult.errorMessage}</p>
  } else if (incomingResult.ok) {
    const responseData = incomingResult.data as RequestQueuesResponse
    const groups = responseData.groups
    if (groups.length === 0) {
      incomingArea = (
        <>
          <p>No incoming requests.</p>
          <p>
            <Link to="/requests">See All Incoming Requests</Link>
          </p>
        </>
      )
    } else {
      const groupViews = []
      for (let index = 0; index < groups.length; index = index + 1) {
        groupViews.push(buildIncomingGroup(groups[index]))
      }
      incomingArea = (
        <>
          <div>{groupViews}</div>
          <p>
            <Link to="/requests">See All Incoming Requests</Link>
          </p>
        </>
      )
    }
  } else {
    incomingArea = <p role="alert">Could not load incoming requests.</p>
  }

  // --- Outgoing requests section --------------------------------------------
  let outgoingArea
  if (outgoingResult === null) {
    outgoingArea = <p>Loading outgoing requests...</p>
  } else if (outgoingResult.errorMessage !== '') {
    outgoingArea = <p role="alert">{outgoingResult.errorMessage}</p>
  } else if (outgoingResult.ok) {
    const responseData = outgoingResult.data as MyRequestsResponse
    const pending = responseData.pending
    if (pending.length === 0) {
      outgoingArea = (
        <>
          <p>You have no pending requests.</p>
          <p>
            <Link to="/my-requests">See All My Requests</Link>
          </p>
        </>
      )
    } else {
      const outgoingRows = []
      for (let index = 0; index < pending.length; index = index + 1) {
        const item = pending[index]
        const requestedAtText = formatTimestamp(item.requested_at)
        const isThisRowPending = withdrawingClaimId === item.id
        // The listing title is plain text here: the my-requests response does not
        // carry the listing status, and the detail page rejects non-active rows,
        // so a link could land on an unavailable page.
        outgoingRows.push(
          <li key={item.id}>
            {item.listing_title}: you requested {item.requested_quantity} on {requestedAtText}{' '}
            <button
              type="button"
              disabled={isThisRowPending}
              onClick={() => handleWithdraw(item.id)}
            >
              Withdraw Request
            </button>
          </li>,
        )
      }
      outgoingArea = (
        <>
          <ul>{outgoingRows}</ul>
          <p>
            <Link to="/my-requests">See All My Requests</Link>
          </p>
        </>
      )
    }
  } else {
    outgoingArea = <p role="alert">Could not load outgoing requests.</p>
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
          <Link to="/my-listings">See All My Listings</Link>
        </li>
        <li>
          <Link to="/invite">Invite a New Member</Link>
        </li>
        <li>
          <Link to="/profile">View Your Profile</Link>
        </li>
        <li>
          <Link to="/requests">See All Incoming Requests</Link>
        </li>
        <li>
          <Link to="/my-requests">See My Requests to Other Members</Link>
        </li>
      </ul>
      <section>
        <h2>Latest Community Listings</h2>
        {previewArea}
        <p>
          <small>{timeZoneNote}</small>
        </p>
      </section>
      <hr />
      <section>
        <h2>My Active Listings</h2>
        {myActiveArea}
        <p>
          <small>{timeZoneNote}</small>
        </p>
      </section>
      <hr />
      <section>
        <h2>Incoming Request Queue</h2>
        {incomingArea}
        <p>
          <small>{timeZoneNote}</small>
        </p>
      </section>
      <hr />
      <section>
        <h2>My Requests to Other Members</h2>
        {outgoingArea}
        <p>
          <small>{timeZoneNote}</small>
        </p>
      </section>
      <hr />
      <section>
        {/* ponytail: placeholder until the exchange-history feature (US-18/US-19
            pickup and completion, R2) is built. Static markup, no fetch: one
            subheading per claim status in lifecycle order. */}
        <h2>Exchange History</h2>
        <p>Exchange history is not available yet.</p>
        <h3>Requested</h3>
        <p>Nothing here yet.</p>
        <h3>Approved</h3>
        <p>Nothing here yet.</p>
        <h3>Picked up</h3>
        <p>Nothing here yet.</p>
        <h3>Completed</h3>
        <p>Nothing here yet.</p>
        <h3>Cancelled</h3>
        <p>Nothing here yet.</p>
        <h3>Denied</h3>
        <p>Nothing here yet.</p>
      </section>
    </section>
  )
}

export default DashboardPage
