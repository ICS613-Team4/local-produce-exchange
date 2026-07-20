import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import {
  sendCompleteExchangeRequest,
  sendDecideClaimRequest,
  sendGetAllRequestsRequest,
} from '../services/requestQueueService'
import type {
  AllRequestItem,
  AllRequestsResponse,
  ListingAllRequestsGroup,
  RequestQueuesResult,
} from '../services/requestQueueService'
import { clearStoredLogin } from '../services/authService'
import { formatTimestamp, getLocalTimeZoneNote } from '../utils/formatTimestamp'
import MemberRatingChip from '../components/MemberRatingChip'
import ReviewLinks from '../components/ReviewLinks'

function RequestQueuesPage() {
  const latestRequestNumber = useRef(0)
  const [searchParams] = useSearchParams()
  const listingFilter = searchParams.get('listing') ?? ''
  const memberId = window.localStorage.getItem('memberId') ?? ''
  const [result, setResult] = useState<RequestQueuesResult | null>(null)
  const [resultFilter, setResultFilter] = useState('')
  const [reloadCounter, setReloadCounter] = useState(0)
  const [decidingClaimId, setDecidingClaimId] = useState('')
  const decisionInFlightRef = useRef('')
  const [completingClaimId, setCompletingClaimId] = useState('')
  const completeInFlightRef = useRef('')

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

  async function handleComplete(claimId: string) {
    if (completeInFlightRef.current === claimId) { return }
    completeInFlightRef.current = claimId

    const confirmed = window.confirm('Mark this exchange complete? This is final.')
    if (confirmed === false) {
      if (completeInFlightRef.current === claimId) { completeInFlightRef.current = '' }
      return
    }

    setCompletingClaimId(claimId)
    const completeResult = await sendCompleteExchangeRequest(memberId, claimId)
    if (completeInFlightRef.current === claimId) { completeInFlightRef.current = '' }
    setCompletingClaimId('')

    if (completeResult.errorMessage !== '') { window.alert(completeResult.errorMessage); return }
    if (completeResult.ok === false) {
      let detailMessage = 'Could not complete the exchange. Please try again.'
      if (typeof completeResult.data === 'object' && completeResult.data !== null) {
        const dataObject = completeResult.data as { detail?: unknown }
        if (typeof dataObject.detail === 'string') { detailMessage = dataObject.detail }
      }
      window.alert(detailMessage); return
    }
    setReloadCounter((currentValue) => currentValue + 1)
  }

  useEffect(() => {
    latestRequestNumber.current = latestRequestNumber.current + 1
    const requestNumber = latestRequestNumber.current
    async function loadAllRequests() {
      const loadedResult = await sendGetAllRequestsRequest(memberId, listingFilter)
      if (requestNumber !== latestRequestNumber.current) { return }
      if (loadedResult.status === 401) {
        clearStoredLogin()
        return
      }
      setResult(loadedResult)
      setResultFilter(listingFilter)
    }
    loadAllRequests()
  }, [memberId, listingFilter, reloadCounter])

  // Map a claim status to its badge colors. Pickup and completion use distinct
  // tokens so they read differently from the green approved badge.
  function getStatusBadge(status: string) {
    if (status === 'requested') return 'bg-warning-bg text-warning'
    if (status === 'approved') return 'bg-success-bg text-success'
    if (status === 'denied') return 'bg-error-bg text-error'
    if (status === 'picked_up') return 'bg-info-bg text-info'
    if (status === 'completed') return 'bg-primary-50 text-primary-700'
    if (status === 'cancelled') return 'bg-background-alt text-text-muted'
    return 'bg-background-alt text-text-muted'
  }

  // Short text for the status badge. An approved or picked-up request carries
  // the quantity that was approved right in the badge ("Approved: 2"), so no
  // separate approval line is needed. picked_up is special-cased so the badge
  // does not render as literal "Picked_up".
  function getStatusBadgeLabel(item: AllRequestItem) {
    let approvedQuantity = 0
    if (item.approved_quantity !== null) {
      approvedQuantity = item.approved_quantity
    }
    if (item.status === 'approved') {
      return 'Approved: ' + approvedQuantity
    }
    if (item.status === 'picked_up') {
      return 'Picked up: ' + approvedQuantity
    }
    return item.status.charAt(0).toUpperCase() + item.status.slice(1)
  }

  // The status outcome lines for one request, one bullet per line. A completed
  // row keeps the approval and pickup history before its completion time.
  function buildStatusOutcomeLines(item: AllRequestItem) {
    if (item.status === 'picked_up') {
      let pickedUpAtText = ''
      if (item.picked_up_at !== null) {
        pickedUpAtText = formatTimestamp(item.picked_up_at)
      }
      return ['Picked up on ' + pickedUpAtText]
    }
    if (item.status === 'completed') {
      let approvedQuantity = 0
      if (item.approved_quantity !== null) { approvedQuantity = item.approved_quantity }
      let approvedAtText = ''
      if (item.approved_at !== null) { approvedAtText = formatTimestamp(item.approved_at) }
      let pickedUpAtText = ''
      if (item.picked_up_at !== null) { pickedUpAtText = formatTimestamp(item.picked_up_at) }
      let completedAtText = ''
      if (item.completed_at !== null) { completedAtText = formatTimestamp(item.completed_at) }
      return [
        'Approved: ' + approvedQuantity + ' on ' + approvedAtText,
        'Picked up on ' + pickedUpAtText,
        'Completed on ' + completedAtText,
      ]
    }
    if (item.status === 'denied') {
      let deniedAtText = ''
      if (item.denied_at !== null) {
        deniedAtText = formatTimestamp(item.denied_at)
      }
      return ['Denied on ' + deniedAtText]
    }
    if (item.status === 'cancelled') {
      let cancelledAtText = ''
      if (item.cancelled_at !== undefined && item.cancelled_at !== null) {
        cancelledAtText = formatTimestamp(item.cancelled_at)
      }
      return ['Cancelled on ' + cancelledAtText]
    }
    return []
  }

  function buildRequestRow(item: AllRequestItem) {
    const requestedAtText = formatTimestamp(item.requested_at)
    const statusOutcomeLines = buildStatusOutcomeLines(item)
    const statusOutcomeItems = []
    for (let index = 0; index < statusOutcomeLines.length; index = index + 1) {
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
    // Styled like the site's small bordered buttons, so the link reads as an
    // action and matches the my-requests page's version of the same control.
    const threadLinkClasses =
      'inline-flex items-center px-3 py-1.5 text-xs font-medium text-primary-600 border border-primary-200 rounded-md hover:bg-primary-50 transition-colors'
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
    let completeButton = null
    if (item.status === 'picked_up') {
      const isThisRowCompleting = completingClaimId === item.id
      completeButton = (
        <button type="button" disabled={isThisRowCompleting} onClick={() => handleComplete(item.id)}
          className="inline-flex items-center px-3 py-1 text-xs font-medium text-primary-700 border border-border rounded-md hover:bg-primary-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          Mark exchange complete
        </button>
      )
    }
    // A completed row lets the poster review the other party, the recipient,
    // on the shared /review screen (US-20). Same screen the recipient's own
    // review link reaches; the backend works out the roles from the claim.
    let reviewButton = null
    if (item.status === 'completed') {
      // The shared pair, in this page's own button variant: write the caller's
      // own review of the recipient (US-20), and read both sides' reviews of
      // the exchange (US-21).
      reviewButton = (
        <ReviewLinks
          claimId={item.id}
          otherPartyName={item.claimant_name}
          fallbackName="the recipient"
          reviewedByMe={item.reviewed_by_me}
          onDeleted={() => setReloadCounter((c) => c + 1)}
          linkClasses="inline-flex items-center px-3 py-1 text-xs font-medium text-primary-700 border border-border rounded-md hover:bg-primary-50 transition-colors"
        />
      )
    }

    // The requestor's rating AS a requestor (US-20), inline right after the
    // requestor's name, so the owner can weigh whose request to accept.
    let claimantRequestorAverage = null
    if (item.claimant_requestor_average !== undefined && item.claimant_requestor_average !== null) {
      claimantRequestorAverage = item.claimant_requestor_average
    }
    let claimantRequestorCount = 0
    if (item.claimant_requestor_count !== undefined) {
      claimantRequestorCount = item.claimant_requestor_count
    }

    return (
      // The row stacks on a phone and goes side by side from the small
      // breakpoint up, the same pattern the dashboard history rows use. A
      // completed row carries three controls, which do not fit one line on a
      // narrow screen, so the controls block below wraps too.
      <li
        key={item.id}
        className="flex flex-col gap-2 py-3 border-b border-border last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
      >
        <div className="min-w-0">
          <p className="text-sm text-text break-words">
            <span className="font-medium">{item.claimant_name}</span>{' '}
            <MemberRatingChip
              memberId={item.claimant_id}
              role="requestor"
              average={claimantRequestorAverage}
              count={claimantRequestorCount}
            />{' '}
            requested {item.requested_quantity}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className={'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ' + badgeClasses}>
              {getStatusBadgeLabel(item)}
            </span>
            <span className="text-xs text-text-muted">{requestedAtText}</span>
          </div>
          <ul className="mt-1">{statusOutcomeItems}</ul>
        </div>
        {(approveButton || denyButton || completeButton || reviewButton || threadLink) && (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            {approveButton}
            {denyButton}
            {completeButton}
            {reviewButton}
            {threadLink}
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
    // The listing's cover photo (its first photo) as a square thumbnail next
    // to the group heading, the same style the my-listings and my-requests
    // rows use. A photo-less listing renders no image.
    let thumbnailArea = null
    if (group.photos !== undefined && group.photos.length > 0) {
      thumbnailArea = (
        <img
          src={'/api/photos/' + group.photos[0].id}
          alt={group.listing_title}
          loading="lazy"
          className="w-20 h-20 sm:w-24 sm:h-24 object-cover rounded-lg border border-border shrink-0"
        />
      )
    }
    // The posted-on line shows under the title when the backend sent the
    // listing's creation time.
    let postedLine = null
    if (group.created_at !== undefined && group.created_at !== null) {
      postedLine = (
        <p className="text-xs text-text-muted mt-0.5">
          Posted {formatTimestamp(group.created_at)}
        </p>
      )
    }
    // A deactivated listing still shows while it has exchanges in flight; the
    // heading marks it the same way the dashboard's incoming queue does, and
    // its title stays plain text because a deactivated listing has no page to
    // show. An active listing's title links to that page. A group without the
    // field reads as active.
    // No color classes on the link: the site's base link style in app.css
    // colors every link and darkens it on hover.
    let titleNode = <Link to={'/listings/' + group.listing_id}>{group.listing_title}</Link>
    if (group.listing_status === 'deactivated') {
      // One text node, not a title plus a separate marker span, so the heading
      // still reads as "Title (deactivated)" to a screen reader.
      titleNode = <>{group.listing_title + ' (deactivated)'}</>
    }
    // The thumbnail sits in the header row next to the title; the request
    // rows below span the card's full width, flush left under the photo.
    return (
      <article key={group.listing_id} className="bg-surface rounded-xl border border-border p-6 shadow-sm">
        <div className="flex items-start gap-4 mb-4">
          {thumbnailArea}
          <div className="flex-1 min-w-0 flex items-start justify-between">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-text">{titleNode}</h2>
              {postedLine}
            </div>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 shrink-0 ml-3">
              {group.remaining_quantity} remaining
            </span>
          </div>
        </div>
        {body}
      </article>
    )
  }

  const timeZoneNote = getLocalTimeZoneNote()

  let contentArea
  if (result === null || resultFilter !== listingFilter) {
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
      <h1 className="text-3xl font-bold text-text mb-6">Requests From Other Members</h1>
      {contentArea}
    </section>
  )
}

export default RequestQueuesPage
