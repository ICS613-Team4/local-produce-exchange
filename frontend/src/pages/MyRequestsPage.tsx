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

  // Map a claim status to its badge colors. picked_up uses the info tokens so
  // the terminal state reads differently from the green "approved" badge.
  function getStatusBadge(status: string) {
    if (status === 'requested') return 'bg-warning-bg text-warning'
    if (status === 'approved') return 'bg-success-bg text-success'
    if (status === 'denied') return 'bg-error-bg text-error'
    if (status === 'picked_up') return 'bg-info-bg text-info'
    return 'bg-background-alt text-text-muted'
  }

  // Build the row for one request. Each row shows the listing title, the
  // quantity that matters for that state, and the time it entered that state.
  function buildRequestRow(item: MyRequestItem) {
    const badgeClasses = getStatusBadge(item.status)

    // Prefix the produce title with the provider's first name — the owner the
    // caller requested from (for example "Dave - Backyard Meyer Lemons"). When no
    // owner name came back, fall back to the bare title so the row still reads
    // cleanly.
    let produceLabel = item.listing_title
    if (item.owner_name !== '') {
      const ownerFirstName = item.owner_name.split(' ')[0]
      produceLabel = ownerFirstName + ' - ' + item.listing_title
    }

    if (item.status === 'approved') {
      let approvedQuantity = 0
      if (item.approved_quantity !== null) { approvedQuantity = item.approved_quantity }
      let approvedAtText = ''
      if (item.approved_at !== null) {
        approvedAtText = formatTimestamp(item.approved_at)
      }
      // Stub link to the (not-built) Exchange Thread feature, the same one the
      // listing detail page shows on an approved request. Next to it, the recipient
      // can confirm they picked the item up; only that row's button greys while its
      // request is in flight.
      const exchangeThreadTarget = '/exchange-thread?claim=' + item.id
      const isThisRowConfirming = confirmingPickupClaimId === item.id
      return (
        <li key={item.id} className="flex items-center justify-between py-3 border-b border-border last:border-0">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">{produceLabel}</p>
            <p className="text-xs text-text-muted mt-0.5">
              You were approved for: {approvedQuantity} on {approvedAtText}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-3">
            <span className={'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ' + badgeClasses}>
              Approved
            </span>
            <Link to={exchangeThreadTarget} className="text-xs font-medium text-primary-600 hover:text-primary-700">
              Arrange the Exchange
            </Link>
            <button
              type="button"
              disabled={isThisRowConfirming}
              onClick={() => handleConfirmPickup(item.id)}
              className="inline-flex items-center px-3 py-1 text-xs font-medium text-primary-600 border border-primary-200 rounded-md hover:bg-primary-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Confirm the Pickup
            </button>
          </div>
        </li>
      )
    }
    if (item.status === 'picked_up') {
      const approvedQuantity = item.approved_quantity ?? item.requested_quantity
      let pickedUpAtText = ''
      if (item.picked_up_at !== null) {
        pickedUpAtText = formatTimestamp(item.picked_up_at)
      }
      return (
        <li key={item.id} className="flex items-center justify-between py-3 border-b border-border last:border-0">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">{produceLabel}</p>
            <p className="text-xs text-text-muted mt-0.5">
              You confirmed pickup for {approvedQuantity} on {pickedUpAtText}
            </p>
          </div>
          <span className={'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ml-3 ' + badgeClasses}>
            Picked up
          </span>
        </li>
      )
    }

    if (item.status === 'denied') {
      let deniedAtText = ''
      if (item.denied_at !== null) { deniedAtText = formatTimestamp(item.denied_at) }
      return (
        <li key={item.id} className="flex items-center justify-between py-3 border-b border-border last:border-0">
          <div className="min-w-0">
            <p className="text-sm font-medium text-text">{produceLabel}</p>
            <p className="text-xs text-text-muted mt-0.5">
              Your request for {item.requested_quantity} was denied on: {deniedAtText}
            </p>
          </div>
          <span className={'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ml-3 ' + badgeClasses}>
            Denied
          </span>
        </li>
      )
    }

    // Pending
    const requestedAtText = formatTimestamp(item.requested_at)
    const isThisRowPending = withdrawingClaimId === item.id
    return (
      <li key={item.id} className="flex items-center justify-between py-3 border-b border-border last:border-0">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">{produceLabel}</p>
          <p className="text-xs text-text-muted mt-0.5">
            You requested {item.requested_quantity} on {requestedAtText}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          <span className={'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ' + badgeClasses}>
            Pending
          </span>
          <button
            type="button"
            disabled={isThisRowPending}
            onClick={() => handleWithdraw(item.id)}
            className="inline-flex items-center px-3 py-1 text-xs font-medium text-text-muted border border-border rounded-md hover:bg-background-alt hover:text-text transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Withdraw
          </button>
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
    const pendingSection = buildSection('Pending', responseData.pending, 'You have no pending requests.')
    const approvedSection = buildSection('Approved', responseData.approved, 'You have no approved requests.')
    const deniedSection = buildSection('Denied', responseData.denied, 'You have no denied requests.')
    contentArea = (
      <>
        <div className="space-y-6">
          {pendingSection}
          {approvedSection}
          {deniedSection}
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
      <h1 className="text-3xl font-bold text-text mb-6">Requests you have made</h1>
      {contentArea}
    </section>
  )
}

export default MyRequestsPage
