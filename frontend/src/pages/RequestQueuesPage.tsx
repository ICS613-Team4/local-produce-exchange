import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import {
  sendDecideClaimRequest,
  sendGetAllRequestsRequest,
} from '../services/requestQueueService'
import type {
  AllRequestItem,
  AllRequestsResponse,
  ListingAllRequestsGroup,
  RequestQueuesResult,
} from '../services/requestQueueService'
import { authStateChangedEventName } from '../services/authService'
import { formatTimestamp, getLocalTimeZoneNote } from '../utils/formatTimestamp'

// One shared message for the not-logged-in case, declared at module scope so the
// wording is the same everywhere and it is not a useEffect dependency.
const notLoggedInMessage = 'You need to be logged in to see this page.'

// The full per-listing request history (US-24): every request on the poster's
// active listings, grouped by listing, all statuses. The live pending queue now
// lives on the dashboard; this page is the action surface for approve/deny on
// requests that are still actionable.
function RequestQueuesPage() {
  // Counts loads so an older response cannot overwrite a newer one (for example
  // after the listing filter changes, a decision reload, or a cleared session).
  const latestRequestNumber = useRef(0)

  // The optional ?listing=<id> filter. Empty means show every active listing; a
  // value means show only that one listing's group (the backend checks ownership).
  const [searchParams] = useSearchParams()
  const listingFilter = searchParams.get('listing') ?? ''

  // memberId is the auth truth: logged in means it is not empty. It lives in
  // state so a stale-session 401 can flip the page to logged-out without a reload.
  const [memberId, setMemberId] = useState(window.localStorage.getItem('memberId') ?? '')

  // Holds the whole response. null means it has not loaded yet, which doubles as
  // the loading state. resultFilter records which filter the held result was
  // loaded for, so a filter change shows "Loading" instead of stale data.
  const [result, setResult] = useState<RequestQueuesResult | null>(null)
  const [resultFilter, setResultFilter] = useState('')

  // Bumped after a decision so the load effect re-runs and the row shows its new
  // status and timestamps, and the remaining quantity reflects the backend value.
  const [reloadCounter, setReloadCounter] = useState(0)

  // The claim id whose decision is in flight, so only that row's buttons grey out.
  const [decidingClaimId, setDecidingClaimId] = useState('')

  // Same-tick double-click guard, holding the claim id in flight.
  const decisionInFlightRef = useRef('')

  // Approve or deny one still-actionable request. Confirms, guards a double-click,
  // calls the decide endpoint, then on success reloads so the row updates. The
  // backend stays the final gate after the click.
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

    // Any HTTP failure (for example a 409 already-decided or a 503).
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

    // Success: reload so the row shows its new status and the remaining quantity
    // updates. The backend response has already computed the display rules.
    setReloadCounter((currentValue) => currentValue + 1)
  }

  // Load the all-requests view when the page has a logged-in member, on a filter
  // change, and after a decision. The request number keeps an older response
  // from replacing a newer load.
  useEffect(() => {
    latestRequestNumber.current = latestRequestNumber.current + 1
    if (memberId === '') {
      return
    }
    const requestNumber = latestRequestNumber.current
    async function loadAllRequests() {
      const loadedResult = await sendGetAllRequestsRequest(memberId, listingFilter)
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
      setResultFilter(listingFilter)
    }
    loadAllRequests()
  }, [memberId, listingFilter, reloadCounter])

  // The status outcome line for one request. Approved and denied show their
  // decision details; every other status shows its plain name.
  function buildStatusOutcome(item: AllRequestItem) {
    if (item.status === 'approved') {
      let approvedQuantity = 0
      if (item.approved_quantity !== null) {
        approvedQuantity = item.approved_quantity
      }
      let approvedAtText = ''
      if (item.approved_at !== null) {
        approvedAtText = formatTimestamp(item.approved_at)
      }
      return 'Approved: ' + approvedQuantity + ' on ' + approvedAtText
    }
    if (item.status === 'denied') {
      let deniedAtText = ''
      if (item.denied_at !== null) {
        deniedAtText = formatTimestamp(item.denied_at)
      }
      return 'Denied on ' + deniedAtText
    }
    return 'Status: ' + item.status
  }

  // Build one request row: who asked and when, the status outcome line, and,
  // when the request is still actionable, the Approve/Deny buttons.
  function buildRequestRow(item: AllRequestItem) {
    const requestedAtText = formatTimestamp(item.requested_at)
    const statusOutcome = buildStatusOutcome(item)

    // Approve and Deny are shown independently. Approve needs remaining stock
    // (can_decide); Deny does not (can_deny), so an exhausted-but-active listing
    // still lets the owner clear a pending request.
    const isThisRowPending = decidingClaimId === item.id
    let approveItem = null
    if (item.can_decide === true) {
      approveItem = (
        <li>
          <button
            type="button"
            disabled={isThisRowPending}
            onClick={() => handleDecision(item.id, 'approve')}
          >
            Approve this request
          </button>
        </li>
      )
    }
    let denyItem = null
    if (item.can_deny === true) {
      denyItem = (
        <li>
          <button
            type="button"
            disabled={isThisRowPending}
            onClick={() => handleDecision(item.id, 'deny')}
          >
            Deny this request
          </button>
        </li>
      )
    }
    let actionList = null
    if (approveItem !== null || denyItem !== null) {
      actionList = (
        <ul>
          {approveItem}
          {denyItem}
        </ul>
      )
    }

    return (
      <li key={item.id}>
        {item.claimant_name} requested {item.requested_quantity} ({requestedAtText})
        <ul>
          <li>{statusOutcome}</li>
        </ul>
        {actionList}
      </li>
    )
  }

  // Build one listing's group: the title, the remaining quantity, and the
  // request rows (or a per-listing empty note when it has none).
  function buildGroupView(group: ListingAllRequestsGroup) {
    let body
    if (group.requests.length === 0) {
      body = <p>No requests on this listing yet.</p>
    } else {
      const rowItems = []
      for (let index = 0; index < group.requests.length; index = index + 1) {
        rowItems.push(buildRequestRow(group.requests[index]))
      }
      body = <ul>{rowItems}</ul>
    }
    return (
      <article key={group.listing_id}>
        <h2>{group.listing_title}</h2>
        <p>Your Remaining Quantity: {group.remaining_quantity}</p>
        {body}
      </article>
    )
  }

  // The note that tells the viewer the request times are in their local zone.
  const timeZoneNote = getLocalTimeZoneNote()

  // Build the content area with a plain if/else chain, checked in a set order.
  let contentArea
  if (memberId === '') {
    contentArea = <p role="alert">{notLoggedInMessage}</p>
  } else if (result === null || resultFilter !== listingFilter) {
    contentArea = <p>Loading your requests...</p>
  } else if (result.errorMessage !== '') {
    contentArea = <p role="alert">{result.errorMessage}</p>
  } else if (result.ok) {
    const responseData = result.data as AllRequestsResponse
    const groups = responseData.groups
    if (listingFilter !== '') {
      // Filtered: the backend returns either the one matching group or none.
      let matchingGroup = null
      for (let index = 0; index < groups.length; index = index + 1) {
        if (groups[index].listing_id === listingFilter) {
          matchingGroup = groups[index]
        }
      }
      if (matchingGroup === null) {
        contentArea = <p>No active listing found for this filter.</p>
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
      contentArea = <p>You have no active listings.</p>
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
