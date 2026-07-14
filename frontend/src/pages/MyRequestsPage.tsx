import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import {
  sendConfirmPickupRequest,
  sendGetMyRequestsRequest,
  sendWithdrawClaimRequest,
} from '../services/requestQueueService'
import type {
  MyRequestItem,
  MyRequestsResponse,
  RequestQueuesResult,
} from '../services/requestQueueService'
import { authStateChangedEventName } from '../services/authService'
import { formatTimestamp, getLocalTimeZoneNote } from '../utils/formatTimestamp'

const notLoggedInMessage = 'You need to be logged in to see this page.'

function MyRequestsPage() {
  const latestRequestNumber = useRef(0)
  const [memberId, setMemberId] = useState(window.localStorage.getItem('memberId') ?? '')
  const [result, setResult] = useState<RequestQueuesResult | null>(null)
  const [reloadCounter, setReloadCounter] = useState(0)
  const [withdrawingClaimId, setWithdrawingClaimId] = useState('')
  const withdrawInFlightRef = useRef('')

  // The claim id whose confirm-pickup is in flight, so only that approved row's
  // button is greyed while it runs. Its own same-tick double-click guard mirrors
  // the withdraw one above.
  const [confirmingPickupClaimId, setConfirmingPickupClaimId] = useState('')
  const pickupInFlightRef = useRef('')

  // Load the caller's outgoing requests when the page has a logged-in member,
  // and again whenever reloadCounter changes (after a successful withdraw).
  useEffect(() => {
    latestRequestNumber.current = latestRequestNumber.current + 1
    if (memberId === '') { return }
    const requestNumber = latestRequestNumber.current
    async function loadMyRequests() {
      const loadedResult = await sendGetMyRequestsRequest(memberId)
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
    }
    loadMyRequests()
  }, [memberId, reloadCounter])

  async function handleWithdraw(claimId: string) {
    if (withdrawInFlightRef.current === claimId) { return }
    withdrawInFlightRef.current = claimId

    const confirmed = window.confirm('Withdraw this request? It will leave the queue.')
    if (confirmed === false) {
      if (withdrawInFlightRef.current === claimId) { withdrawInFlightRef.current = '' }
      return
    }

    setWithdrawingClaimId(claimId)
    const withdrawResult = await sendWithdrawClaimRequest(memberId, claimId)
    if (withdrawInFlightRef.current === claimId) { withdrawInFlightRef.current = '' }
    setWithdrawingClaimId('')

    if (withdrawResult.errorMessage !== '') { window.alert(withdrawResult.errorMessage); return }
    if (withdrawResult.ok === false) {
      let detailMessage = 'Could not withdraw the request. Please try again.'
      if (typeof withdrawResult.data === 'object' && withdrawResult.data !== null) {
        const dataObject = withdrawResult.data as { detail?: unknown }
        if (typeof dataObject.detail === 'string') { detailMessage = dataObject.detail }
      }
      window.alert(detailMessage); return
    }
    setReloadCounter((currentValue) => currentValue + 1)
  }

  // Confirm pickup on one of the caller's approved requests. Same shape as the
  // withdraw handler above: a same-tick double-click guard, a confirm, the call,
  // then the result handling. On success, bump reloadCounter so the row reloads
  // and moves from "approved" to its picked-up line. The backend is the final
  // gate: it checks the caller is the claimant and the request is still approved.
  async function handleConfirmPickup(claimId: string) {
    if (pickupInFlightRef.current === claimId) {
      return
    }
    pickupInFlightRef.current = claimId

    const confirmed = window.confirm('Confirm that you picked up this item? This cannot be undone.')
    if (confirmed === false) {
      if (pickupInFlightRef.current === claimId) {
        pickupInFlightRef.current = ''
      }
      return
    }

    setConfirmingPickupClaimId(claimId)

    const pickupResult = await sendConfirmPickupRequest(memberId, claimId)

    if (pickupInFlightRef.current === claimId) {
      pickupInFlightRef.current = ''
    }
    setConfirmingPickupClaimId('')

    if (pickupResult.errorMessage !== '') {
      window.alert(pickupResult.errorMessage)
      return
    }

    if (pickupResult.ok === false) {
      let detailMessage = 'Could not confirm pickup. Please try again.'
      if (typeof pickupResult.data === 'object' && pickupResult.data !== null) {
        const dataObject = pickupResult.data as { detail?: unknown }
        if (typeof dataObject.detail === 'string') {
          detailMessage = dataObject.detail
        }
      }
      window.alert(detailMessage)
      return
    }

    setReloadCounter((currentValue) => currentValue + 1)
  }

  // Placeholder for the review feature (US-20). The button renders on
  // completed rows now so the flow is visible, but the review form itself is
  // US-20's to build; until then the click explains that.
  function handleLeaveReview() {
    window.alert(
      'Reviews are not built yet. Leaving a rating and review for a completed exchange arrives with user story US-20.',
    )
  }

  // Map a claim status to its badge colors. Pickup and completion use distinct
  // tokens so they read differently from the green approved badge, matching
  // the poster's all-requests page.
  function getStatusBadge(status: string) {
    if (status === 'requested') return 'bg-warning-bg text-warning'
    if (status === 'approved') return 'bg-success-bg text-success'
    if (status === 'denied') return 'bg-error-bg text-error'
    if (status === 'picked_up') return 'bg-info-bg text-info'
    if (status === 'completed') return 'bg-primary-50 text-primary-700'
    return 'bg-background-alt text-text-muted'
  }

  // Build the row for one request. Each row shows the listing title, the
  // quantity that matters for that state, and the time it entered that state.
  function buildRequestRow(item: MyRequestItem) {
    const badgeClasses = getStatusBadge(item.status)

    // The produce title, with the provider named after it in smaller muted
    // text (for example "Backyard Meyer Lemons from Dave"), so the row shows
    // who posted the listing without changing the title itself. When no owner
    // name came back, only the title shows.
    let titleNode = <>{item.listing_title}</>
    if (item.owner_name !== '') {
      const ownerFirstName = item.owner_name.split(' ')[0]
      titleNode = (
        <>
          {item.listing_title}
          <span className="text-xs font-normal text-text-muted"> from {ownerFirstName}</span>
        </>
      )
    }

    // The requested listing's cover photo (its first photo) as a square
    // thumbnail on the left of the row, the same size the my-listings rows
    // use. A photo-less listing renders no image.
    let thumbnailArea = null
    if (item.photos !== undefined && item.photos.length > 0) {
      thumbnailArea = (
        <img
          src={'/api/photos/' + item.photos[0].id}
          alt={item.listing_title}
          loading="lazy"
          className="w-20 h-20 sm:w-24 sm:h-24 object-cover rounded-lg border border-border shrink-0"
        />
      )
    }

    // The per-status pieces: the badge label, the muted detail line, and the
    // controls row that sits under the text, the same arrangement the
    // my-listings rows use (badge top-right, buttons below).
    let badgeLabel
    let detailLine
    let controlsArea = null
    if (item.status === 'approved') {
      badgeLabel = 'Approved'
      let approvedQuantity = 0
      if (item.approved_quantity !== null) { approvedQuantity = item.approved_quantity }
      let approvedAtText = ''
      if (item.approved_at !== null) {
        approvedAtText = formatTimestamp(item.approved_at)
      }
      detailLine = <>You were approved for: {approvedQuantity} on {approvedAtText}</>
      // Stub link to the (not-built) Exchange Thread feature, the same one the
      // listing detail page shows on an approved request. Next to it, the recipient
      // can confirm they picked the item up; only that row's button greys while its
      // request is in flight.
      const exchangeThreadTarget = '/exchange-thread?claim=' + item.id
      const isThisRowConfirming = confirmingPickupClaimId === item.id
      controlsArea = (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Link
            to={exchangeThreadTarget}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-primary-600 border border-primary-200 rounded-md hover:bg-primary-50 transition-colors"
          >
            Arrange the Exchange
          </Link>
          <button
            type="button"
            disabled={isThisRowConfirming}
            onClick={() => handleConfirmPickup(item.id)}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-primary-600 border border-primary-200 rounded-md hover:bg-primary-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm the Pickup
          </button>
        </div>
      )
    } else if (item.status === 'picked_up') {
      badgeLabel = 'Picked up'
      const approvedQuantity = item.approved_quantity ?? item.requested_quantity
      let pickedUpAtText = ''
      if (item.picked_up_at !== null) {
        pickedUpAtText = formatTimestamp(item.picked_up_at)
      }
      detailLine = <>You confirmed pickup for {approvedQuantity} on {pickedUpAtText}</>
      const exchangeThreadTarget = '/exchange-thread?claim=' + item.id
      controlsArea = (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <Link
            to={exchangeThreadTarget}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-primary-600 border border-primary-200 rounded-md hover:bg-primary-50 transition-colors"
          >
            Contact the Poster
          </Link>
        </div>
      )
    } else if (item.status === 'completed') {
      badgeLabel = 'Completed'
      const approvedQuantity = item.approved_quantity ?? item.requested_quantity
      let completedAtText = ''
      if (item.completed_at !== undefined && item.completed_at !== null) {
        completedAtText = formatTimestamp(item.completed_at)
      }
      // A finished exchange: the poster marked it complete after the pickup.
      // No thread link here, matching the poster's all-requests page, where a
      // completed row also loses its link. The review button reviews the other
      // party, the poster; the form itself is US-20's (see handleLeaveReview).
      detailLine = <>Your exchange for {approvedQuantity} was completed on {completedAtText}</>
      let posterFirstName = 'the poster'
      if (item.owner_name !== '') {
        posterFirstName = item.owner_name.split(' ')[0]
      }
      controlsArea = (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button
            type="button"
            onClick={() => handleLeaveReview()}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-primary-600 border border-primary-200 rounded-md hover:bg-primary-50 transition-colors"
          >
            Leave a Review for {posterFirstName}
          </button>
        </div>
      )
    } else if (item.status === 'denied') {
      badgeLabel = 'Denied'
      let deniedAtText = ''
      if (item.denied_at !== null) { deniedAtText = formatTimestamp(item.denied_at) }
      detailLine = <>Your request for {item.requested_quantity} was denied on: {deniedAtText}</>
    } else if (item.status === 'cancelled') {
      badgeLabel = 'Withdrawn'
      let cancelledAtText = ''
      if (item.cancelled_at !== undefined && item.cancelled_at !== null) {
        cancelledAtText = formatTimestamp(item.cancelled_at)
      }
      // Neutral wording on purpose: a request lands here when the recipient
      // withdraws it, when the poster cancels an approved exchange, or when
      // the listing is deactivated, and the row cannot tell which happened.
      detailLine = <>This request was cancelled on {cancelledAtText}</>
    } else {
      // Pending
      badgeLabel = 'Pending'
      const requestedAtText = formatTimestamp(item.requested_at)
      detailLine = <>You requested {item.requested_quantity} on {requestedAtText}</>
      const isThisRowPending = withdrawingClaimId === item.id
      controlsArea = (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button
            type="button"
            disabled={isThisRowPending}
            onClick={() => handleWithdraw(item.id)}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-text-muted border border-border rounded-md hover:bg-background-alt hover:text-text transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Withdraw
          </button>
        </div>
      )
    }

    return (
      <li key={item.id} className="py-3 border-b border-border last:border-0">
        <div className="flex items-start gap-4">
          {thumbnailArea}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text">{titleNode}</p>
                <p className="text-xs text-text-muted mt-0.5">{detailLine}</p>
              </div>
              <span className={'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ml-3 ' + badgeClasses}>
                {badgeLabel}
              </span>
            </div>
            {controlsArea}
          </div>
        </div>
      </li>
    )
  }

  function buildSection(heading: string, items: MyRequestItem[], emptyText: string) {
    let body
    if (items.length === 0) {
      body = <p className="text-sm text-text-muted py-3">{emptyText}</p>
    } else {
      const rows = []
      for (let index = 0; index < items.length; index = index + 1) {
        rows.push(buildRequestRow(items[index]))
      }
      body = <ul>{rows}</ul>
    }
    return (
      <div className="bg-surface rounded-xl border border-border p-6 shadow-sm">
        <h2 className="text-base font-semibold text-text mb-4">{heading}</h2>
        {body}
      </div>
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
  } else if (result === null) {
    contentArea = <p className="text-text-muted text-sm py-8 text-center">Loading your requests...</p>
  } else if (result.errorMessage !== '') {
    contentArea = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
        {result.errorMessage}
      </div>
    )
  } else if (result.ok) {
    const responseData = result.data as MyRequestsResponse
    // An older cached response may lack the completed or withdrawn lists;
    // treat a missing list as empty.
    let completedItems = responseData.completed
    if (completedItems === undefined) {
      completedItems = []
    }
    let withdrawnItems = responseData.withdrawn
    if (withdrawnItems === undefined) {
      withdrawnItems = []
    }
    const pendingSection = buildSection('Pending', responseData.pending, 'You have no pending requests.')
    const approvedSection = buildSection('Approved', responseData.approved, 'You have no approved requests.')
    const completedSection = buildSection('Completed', completedItems, 'You have no completed exchanges.')
    const deniedSection = buildSection('Denied', responseData.denied, 'You have no denied requests.')
    const withdrawnSection = buildSection('Withdrawn', withdrawnItems, 'You have no withdrawn requests.')
    // The time-zone note shows above and below the sections, so it is visible
    // without scrolling and again next to the last timestamps on the page.
    contentArea = (
      <>
        <p className="text-xs text-text-muted mb-4">{timeZoneNote}</p>
        <div className="space-y-6">
          {pendingSection}
          {approvedSection}
          {completedSection}
          {deniedSection}
          {withdrawnSection}
        </div>
        <p className="text-xs text-text-muted mt-4">{timeZoneNote}</p>
      </>
    )
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
      <h1 className="text-3xl font-bold text-text mb-6">Requests You Have Made</h1>
      {contentArea}
    </section>
  )
}

export default MyRequestsPage
