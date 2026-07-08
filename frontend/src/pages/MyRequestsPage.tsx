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

  // Bumped after a successful withdraw to re-run the load effect, so the
  // withdrawn row drops out of the Pending section without a full page reload.
  const [reloadCounter, setReloadCounter] = useState(0)

  // The claim id whose withdraw is in flight, so only that row's button is
  // greyed while it runs.
  const [withdrawingClaimId, setWithdrawingClaimId] = useState('')

  // Same-tick double-click guard, holding the claim id in flight, like the
  // Dashboard's withdraw handler.
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
  }, [memberId, reloadCounter])

  // Withdraw one of the caller's own pending requests. Same shape and wording as
  // the Dashboard's handler: a same-tick double-click guard, a confirm, the
  // call, then the result handling. On success, bump reloadCounter so the list
  // reloads and the withdrawn row drops out of Pending.
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

  // Build the row text for one request. Each section shows the listing title, the
  // quantity that matters for that state, and the time it entered that state.
  function buildRequestRow(item: MyRequestItem) {
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
      // listing detail page shows on an approved request. Next to it, the recipient
      // can confirm they picked the item up; only that row's button greys while its
      // request is in flight.
      const exchangeThreadTarget = '/exchange-thread?claim=' + item.id
      const isThisRowConfirming = confirmingPickupClaimId === item.id
      return (
        <li key={item.id}>
          {produceLabel}: You were approved for: {approvedQuantity} on {approvedAtText}{' '}
          <Link to={exchangeThreadTarget}>Arrange the Exchange</Link>{' '}
          <button
            type="button"
            disabled={isThisRowConfirming}
            onClick={() => handleConfirmPickup(item.id)}
          >
            Confirm the Pickup
          </button>
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
        <li key={item.id}>
          {produceLabel}: You confirmed pickup for {approvedQuantity} on {pickedUpAtText}
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
          {produceLabel}: Your request for {item.requested_quantity} was denied on:{' '}
          {deniedAtText}
        </li>
      )
    }
    // Pending. A pending request can be withdrawn, so show the Withdraw button
    // the same way the Dashboard does.
    const requestedAtText = formatTimestamp(item.requested_at)
    const isThisRowPending = withdrawingClaimId === item.id
    return (
      <li key={item.id}>
        {produceLabel}: You requested {item.requested_quantity} on {requestedAtText}{' '}
        <button
          type="button"
          disabled={isThisRowPending}
          onClick={() => handleWithdraw(item.id)}
        >
          Withdraw Request
        </button>
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
