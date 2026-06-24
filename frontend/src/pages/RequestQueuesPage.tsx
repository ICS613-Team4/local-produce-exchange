import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import {
  sendGetRequestQueuesRequest,
  sendDecideClaimRequest,
} from '../services/requestQueueService'
import type {
  ClaimDecisionResponse,
  ListingQueueGroup,
  QueueClaimItem,
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

  // Records the requests the owner has just approved or denied on this page, so
  // their Approve/Deny buttons turn into a "You approved/denied this request
  // on: X" line. Keyed by claim id; each value holds the verb ("approved" or
  // "denied") and the timestamp the backend recorded the decision.
  type ClaimDecision = {
    verb: string
    approvedQuantity: number
    decidedAt: string
  }
  const [decisions, setDecisions] = useState<Record<string, ClaimDecision>>({})

  // Approve or deny one pending request. Asks for a final confirmation that
  // names the quantity, makes the API call, and on success records the decision
  // so the row swaps its buttons for the result line.
  async function handleDecision(
    item: QueueClaimItem,
    remainingQuantity: number,
    decision: string,
  ) {
    let confirmMessage
    if (decision === 'approve') {
      // Partial fill: the listing allocates as much as the request asks for, but
      // never more than what is left. Show the amount that will actually be
      // allocated, and call out when it is less than what was requested.
      let allocatedQuantity = item.requested_quantity
      if (remainingQuantity < item.requested_quantity) {
        allocatedQuantity = remainingQuantity
      }
      confirmMessage =
        'This is final. Approving this request will allocate ' +
        allocatedQuantity +
        ' item(s) to ' +
        item.claimant_name +
        '.'
      if (allocatedQuantity < item.requested_quantity) {
        confirmMessage =
          confirmMessage +
          ' They requested ' +
          item.requested_quantity +
          ', but only ' +
          remainingQuantity +
          ' remain.'
      }
      confirmMessage = confirmMessage + ' Continue?'
    } else {
      confirmMessage =
        'This is final. Denying this request is permanent. The ' +
        item.requested_quantity +
        ' item(s) asked for will not be allocated. Continue?'
    }

    const confirmed = window.confirm(confirmMessage)
    if (confirmed === false) {
      return
    }

    const decisionResult = await sendDecideClaimRequest(memberId, item.id, decision)

    // A timeout or network failure comes back with status 0 and a message.
    if (decisionResult.errorMessage !== '') {
      window.alert(decisionResult.errorMessage)
      return
    }

    // Any HTTP failure (for example a 403 non-owner, a 409 already-decided, or a
    // 503). Show the server's plain-words detail, with a fallback line.
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

    // Success. Read the timestamp the backend stamped for this decision, and the
    // amount it actually allocated (only meaningful for an approval).
    const responseData = decisionResult.data as ClaimDecisionResponse
    let decidedAt = ''
    let verb: string
    let approvedQuantity = 0
    if (decision === 'approve') {
      verb = 'approved'
      if (responseData.approved_at !== null) {
        decidedAt = responseData.approved_at
      }
      if (responseData.approved_quantity !== null) {
        approvedQuantity = responseData.approved_quantity
      }
    } else {
      verb = 'denied'
      if (responseData.denied_at !== null) {
        decidedAt = responseData.denied_at
      }
    }

    // Add this claim to the decisions map without mutating the old object.
    const newDecisions: Record<string, ClaimDecision> = {}
    for (const key in decisions) {
      newDecisions[key] = decisions[key]
    }
    newDecisions[item.id] = {
      verb: verb,
      approvedQuantity: approvedQuantity,
      decidedAt: decidedAt,
    }
    setDecisions(newDecisions)

    // Approving allocates the items, so the backend lowered the listing's
    // remaining quantity. Lower the displayed number to match, without a
    // re-fetch (a re-fetch would drop the just-approved row, hiding the result
    // line above). Denying changes no quantity, so only approve updates this.
    // Build new objects rather than mutating the held result in place.
    if (decision === 'approve' && result !== null) {
      // Use the amount the backend actually allocated (a partial fill can make
      // this less than the requested amount), not the requested amount.
      const allocatedQuantity = approvedQuantity
      const oldResponse = result.data as RequestQueuesResponse
      const newGroups = []
      for (let groupIndex = 0; groupIndex < oldResponse.groups.length; groupIndex = groupIndex + 1) {
        const oldGroup = oldResponse.groups[groupIndex]
        if (oldGroup.listing_id === responseData.listing_id) {
          // The backend never allocates more than what is left, so this
          // subtraction should not go negative. Clamp at 0 anyway in case the
          // displayed number was stale, so the page never shows a negative
          // remaining quantity.
          let loweredRemaining = oldGroup.remaining_quantity - allocatedQuantity
          if (loweredRemaining < 0) {
            loweredRemaining = 0
          }
          const updatedGroup: ListingQueueGroup = {
            listing_id: oldGroup.listing_id,
            listing_title: oldGroup.listing_title,
            listing_status: oldGroup.listing_status,
            remaining_quantity: loweredRemaining,
            pending: oldGroup.pending,
          }
          newGroups.push(updatedGroup)
        } else {
          newGroups.push(oldGroup)
        }
      }
      const newResponse: RequestQueuesResponse = { groups: newGroups }
      const newResult: RequestQueuesResult = {
        ok: result.ok,
        status: result.status,
        data: newResponse,
        errorMessage: result.errorMessage,
      }
      setResult(newResult)
    }
  }

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

      // The sub-bullets under each request. Once the owner has approved or denied
      // it on this page, show the result line instead of the buttons.
      let actionSubList
      const existingDecision = decisions[item.id]
      if (existingDecision !== undefined) {
        const decidedAtText = formatTimestamp(existingDecision.decidedAt)
        let resultLine
        if (existingDecision.verb === 'approved') {
          resultLine = (
            <li>
              You approved: {existingDecision.approvedQuantity} on: {decidedAtText}
            </li>
          )
        } else {
          resultLine = <li>You denied this request on: {decidedAtText}</li>
        }
        actionSubList = <ul>{resultLine}</ul>
      } else {
        actionSubList = (
          <ul>
            <li>
              <button
                type="button"
                onClick={() => handleDecision(item, group.remaining_quantity, 'approve')}
              >
                Approve this request
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => handleDecision(item, group.remaining_quantity, 'deny')}
              >
                Deny this request
              </button>
            </li>
          </ul>
        )
      }

      rowItems.push(
        <li key={item.id}>
          {item.claimant_name} requested {item.requested_quantity} ({requestedAtText})
          {actionSubList}
        </li>,
      )
    }
    return (
      <article key={group.listing_id}>
        <h2>{titleText}</h2>
        <p>Your Remaining Quantity: {group.remaining_quantity}</p>
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
