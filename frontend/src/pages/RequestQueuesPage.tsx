import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

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

const notLoggedInMessage = 'You need to be logged in to see this page.'

function RequestQueuesPage() {
  const latestRequestNumber = useRef(0)
  const [searchParams] = useSearchParams()
  const listingFilter = searchParams.get('listing') ?? ''
  const [memberId, setMemberId] = useState(window.localStorage.getItem('memberId') ?? '')
  const [result, setResult] = useState<RequestQueuesResult | null>(null)
  const [resultFilter, setResultFilter] = useState('')
  const [reloadCounter, setReloadCounter] = useState(0)
  const [decidingClaimId, setDecidingClaimId] = useState('')
  const decisionInFlightRef = useRef('')

  async function handleDecision(claimId: string, decision: string) {
    if (decisionInFlightRef.current === claimId) { return }
    decisionInFlightRef.current = claimId

    let confirmMessage = 'Approve this request? This is final.'
    if (decision === 'deny') { confirmMessage = 'Deny this request? This is final.' }
    const confirmed = window.confirm(confirmMessage)
    if (confirmed === false) {
      if (decisionInFlightRef.current === claimId) { decisionInFlightRef.current = '' }
      return
    }

    setDecidingClaimId(claimId)
    const decisionResult = await sendDecideClaimRequest(memberId, claimId, decision)
    if (decisionInFlightRef.current === claimId) { decisionInFlightRef.current = '' }
    setDecidingClaimId('')

    if (decisionResult.errorMessage !== '') { window.alert(decisionResult.errorMessage); return }
    if (decisionResult.ok === false) {
      let detailMessage = 'Could not update the request. Please try again.'
      if (typeof decisionResult.data === 'object' && decisionResult.data !== null) {
        const dataObject = decisionResult.data as { detail?: unknown }
        if (typeof dataObject.detail === 'string') { detailMessage = dataObject.detail }
      }
      window.alert(detailMessage); return
    }
    setReloadCounter((currentValue) => currentValue + 1)
  }

  useEffect(() => {
    latestRequestNumber.current = latestRequestNumber.current + 1
    if (memberId === '') { return }
    const requestNumber = latestRequestNumber.current
    async function loadAllRequests() {
      const loadedResult = await sendGetAllRequestsRequest(memberId, listingFilter)
      if (requestNumber !== latestRequestNumber.current) { return }
      if (loadedResult.status === 401) {
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

  // Map a claim status to its badge colors. picked_up uses the info tokens so
  // the terminal state reads differently from the green "approved" badge.
  function getStatusBadge(status: string) {
    if (status === 'requested') return 'bg-warning-bg text-warning'
    if (status === 'approved') return 'bg-success-bg text-success'
    if (status === 'denied') return 'bg-error-bg text-error'
    if (status === 'picked_up') return 'bg-info-bg text-info'
    if (status === 'cancelled') return 'bg-background-alt text-text-muted'
    return 'bg-background-alt text-text-muted'
  }

  // Short text for the status badge. picked_up is special-cased so the badge
  // does not render as literal "Picked_up".
  function getStatusBadgeLabel(status: string) {
    if (status === 'picked_up') return 'Picked up'
    return status.charAt(0).toUpperCase() + status.slice(1)
  }

  // The status outcome lines for one request, one bullet per line. Approved and
  // denied show their decision details; a picked-up request keeps its Approved
  // line and adds a "Picked up on" line below it, so the owner can see both the
  // approval and that the recipient confirmed the pickup. Every other status
  // shows its plain name.
  function buildStatusOutcomeLines(item: AllRequestItem) {
    if (item.status === 'approved') {
      let approvedQuantity = 0
      if (item.approved_quantity !== null) { approvedQuantity = item.approved_quantity }
      let approvedAtText = ''
      if (item.approved_at !== null) {
        approvedAtText = formatTimestamp(item.approved_at)
      }
      return ['Approved: ' + approvedQuantity + ' on ' + approvedAtText]
    }
    if (item.status === 'picked_up') {
      // A picked-up request was approved first, so its approval details are still
      // set. Show the same Approved line, then the picked-up line right below it.
      let approvedQuantity = 0
      if (item.approved_quantity !== null) {
        approvedQuantity = item.approved_quantity
      }
      let approvedAtText = ''
      if (item.approved_at !== null) {
        approvedAtText = formatTimestamp(item.approved_at)
      }
      let pickedUpAtText = ''
      if (item.picked_up_at !== null) {
        pickedUpAtText = formatTimestamp(item.picked_up_at)
      }
      return [
        'Approved: ' + approvedQuantity + ' on ' + approvedAtText,
        'Picked up on ' + pickedUpAtText,
      ]
    }
    if (item.status === 'denied') {
      let deniedAtText = ''
      if (item.denied_at !== null) {
        deniedAtText = formatTimestamp(item.denied_at)
      }
      return ['Denied on ' + deniedAtText]
    }
    return ['Status: ' + item.status]
  }

  function buildRequestRow(item: AllRequestItem) {
    const requestedAtText = formatTimestamp(item.requested_at)
    const statusOutcomeLines = buildStatusOutcomeLines(item)
    const statusOutcomeItems = []
    for (let index = 0; index < statusOutcomeLines.length; index = index + 1) {
      // The generic "Status: x" fallback duplicates the badge, so skip it. The
      // detail lines (approval, denial, pickup) still render below the badge.
      if (statusOutcomeLines[index] === 'Status: ' + item.status) {
        continue
      }
      statusOutcomeItems.push(
        <li key={index} className="text-xs text-text-muted">
          {statusOutcomeLines[index]}
        </li>,
      )
    }
    // The exchange thread stays reachable after pickup too. Before pickup the
    // link is about arranging the handoff; once the recipient has confirmed the
    // pickup, the handoff is done, so the link becomes "Contact the Recipient"
    // (the owner viewing this page is the provider, so they contact the recipient).
    const threadLinkClasses =
      'inline-flex items-center mt-1 text-xs font-medium text-primary-600 hover:text-primary-700'
    let threadLink = null
    if (item.status === 'approved') {
      const exchangeThreadTarget = '/exchange-thread?claim=' + item.id
      threadLink = (
        <Link to={exchangeThreadTarget} className={threadLinkClasses}>
          Arrange the Exchange
        </Link>
      )
    } else if (item.status === 'picked_up') {
      const exchangeThreadTarget = '/exchange-thread?claim=' + item.id
      threadLink = (
        <Link to={exchangeThreadTarget} className={threadLinkClasses}>
          Contact the Recipient
        </Link>
      )
    }

    // Approve and Deny are shown independently. Approve needs remaining stock
    // (can_decide); Deny does not (can_deny), so an exhausted-but-active listing
    // still lets the owner clear a pending request.
    const isThisRowPending = decidingClaimId === item.id
    const badgeClasses = getStatusBadge(item.status)

    let approveButton = null
    if (item.can_decide === true) {
      approveButton = (
        <button type="button" disabled={isThisRowPending} onClick={() => handleDecision(item.id, 'approve')}
          className="inline-flex items-center px-3 py-1 text-xs font-medium text-success border border-green-200 rounded-md hover:bg-success-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          Approve
        </button>
      )
    }
    let denyButton = null
    if (item.can_deny === true) {
      denyButton = (
        <button type="button" disabled={isThisRowPending} onClick={() => handleDecision(item.id, 'deny')}
          className="inline-flex items-center px-3 py-1 text-xs font-medium text-error border border-red-200 rounded-md hover:bg-error-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          Deny
        </button>
      )
    }

    return (
      <li key={item.id} className="flex items-center justify-between py-3 border-b border-border last:border-0">
        <div className="min-w-0">
          <p className="text-sm text-text">
            <span className="font-medium">{item.claimant_name}</span> requested {item.requested_quantity}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className={'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ' + badgeClasses}>
              {getStatusBadgeLabel(item.status)}
            </span>
            <span className="text-xs text-text-muted">{requestedAtText}</span>
          </div>
          <ul className="mt-1">{statusOutcomeItems}</ul>
          {threadLink}
        </div>
        {(approveButton || denyButton) && (
          <div className="flex items-center gap-2 shrink-0 ml-3">
            {approveButton}
            {denyButton}
          </div>
        )}
      </li>
    )
  }

  function buildGroupView(group: ListingAllRequestsGroup) {
    let body
    if (group.requests.length === 0) {
      body = <p className="text-sm text-text-muted py-3">No requests on this listing yet.</p>
    } else {
      const rowItems = []
      for (let index = 0; index < group.requests.length; index = index + 1) {
        rowItems.push(buildRequestRow(group.requests[index]))
      }
      body = <ul>{rowItems}</ul>
    }
    return (
      <article key={group.listing_id} className="bg-surface rounded-xl border border-border p-6 shadow-sm">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-base font-semibold text-text">{group.listing_title}</h2>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 shrink-0 ml-3">
            {group.remaining_quantity} remaining
          </span>
        </div>
        {body}
      </article>
    )
  }

  const timeZoneNote = getLocalTimeZoneNote()

  let contentArea
  if (memberId === '') {
    contentArea = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
        {notLoggedInMessage}
      </div>
    )
  } else if (result === null || resultFilter !== listingFilter) {
    contentArea = <p className="text-text-muted text-sm py-8 text-center">Loading your requests...</p>
  } else if (result.errorMessage !== '') {
    contentArea = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
        {result.errorMessage}
      </div>
    )
  } else if (result.ok) {
    const responseData = result.data as AllRequestsResponse
    const groups = responseData.groups
    if (listingFilter !== '') {
      let matchingGroup = null
      for (let index = 0; index < groups.length; index = index + 1) {
        if (groups[index].listing_id === listingFilter) { matchingGroup = groups[index] }
      }
      if (matchingGroup === null) {
        contentArea = <p className="text-sm text-text-muted">No active listing found for this filter.</p>
      } else {
        contentArea = (
          <>
            {buildGroupView(matchingGroup)}
            <p className="text-xs text-text-muted mt-4">{timeZoneNote}</p>
          </>
        )
      }
    } else if (groups.length === 0) {
      contentArea = (
        <div className="text-center py-12">
          <span className="text-4xl mb-4 block">📭</span>
          <p className="text-text-muted">You have no active listings.</p>
        </div>
      )
    } else {
      const groupViews = []
      for (let index = 0; index < groups.length; index = index + 1) {
        groupViews.push(buildGroupView(groups[index]))
      }
      contentArea = (
        <>
          <div className="space-y-6">{groupViews}</div>
          <p className="text-xs text-text-muted mt-4">{timeZoneNote}</p>
        </>
      )
    }
  } else {
    let detailMessage = 'Could not load your requests. Please try again.'
    if (typeof result.data === 'object' && result.data !== null) {
      const dataObject = result.data as { detail?: unknown }
      if (typeof dataObject.detail === 'string') { detailMessage = dataObject.detail }
    }
    contentArea = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
        {detailMessage}
      </div>
    )
  }

  return (
    <section>
      <h1 className="text-3xl font-bold text-text mb-6">Requests from other members</h1>
      {contentArea}
    </section>
  )
}

export default RequestQueuesPage
