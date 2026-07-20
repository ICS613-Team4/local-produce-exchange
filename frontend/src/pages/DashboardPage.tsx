import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { sendBrowseListingsRequest, sendGetMyListingsRequest } from '../services/listingService'
import type { ListingDetail, ListingResult } from '../services/listingService'
import {
  sendCompleteExchangeRequest,
  sendConfirmPickupRequest,
  sendDecideClaimRequest,
  sendGetExchangeHistoryRequest,
  sendGetMyRequestsRequest,
  sendGetRequestQueuesRequest,
  sendWithdrawClaimRequest,
} from '../services/requestQueueService'
import type {
  ExchangeHistoryItem,
  ExchangeHistoryResponse,
  ListingQueueGroup,
  MyRequestsResponse,
  RequestQueuesResponse,
  RequestQueuesResult,
} from '../services/requestQueueService'
import { formatTimestamp, getLocalTimeZoneNote } from '../utils/formatTimestamp'
import MemberRatingChip from '../components/MemberRatingChip'

function DashboardPage() {
  const memberId = window.localStorage.getItem('memberId') ?? ''
  const memberName = window.localStorage.getItem('memberName') ?? ''

  const [previewResult, setPreviewResult] = useState<ListingResult | null>(null)
  const [myListingsResult, setMyListingsResult] = useState<ListingResult | null>(null)
  const [incomingResult, setIncomingResult] = useState<RequestQueuesResult | null>(null)
  const [outgoingResult, setOutgoingResult] = useState<RequestQueuesResult | null>(null)

  const [incomingReload, setIncomingReload] = useState(0)
  const [outgoingReload, setOutgoingReload] = useState(0)

  const [decidingClaimId, setDecidingClaimId] = useState('')
  const [withdrawingClaimId, setWithdrawingClaimId] = useState('')

  const decisionInFlightRef = useRef('')
  const withdrawInFlightRef = useRef('')

  // Exchange History (US-24): the whole history loads once and the three tabs
  // only choose what to show, so switching tabs never refetches.
  const [historyResult, setHistoryResult] = useState<RequestQueuesResult | null>(null)
  const [historyReload, setHistoryReload] = useState(0)
  const [activeHistoryTab, setActiveHistoryTab] = useState('needs_you')
  const [confirmingPickupClaimId, setConfirmingPickupClaimId] = useState('')
  const [completingClaimId, setCompletingClaimId] = useState('')
  const pickupInFlightRef = useRef('')
  const completeInFlightRef = useRef('')

  useEffect(() => {
    if (memberId === '') { return }
    async function loadPreview() {
      const loadedResult = await sendBrowseListingsRequest(memberId, { limit: 5 })
      setPreviewResult(loadedResult)
    }
    loadPreview()
  }, [memberId])

  useEffect(() => {
    if (memberId === '') { return }
    async function loadMyListings() {
      const loadedResult = await sendGetMyListingsRequest(memberId)
      setMyListingsResult(loadedResult)
    }
    loadMyListings()
  }, [memberId])

  useEffect(() => {
    if (memberId === '') { return }
    async function loadIncoming() {
      const loadedResult = await sendGetRequestQueuesRequest(memberId, '')
      setIncomingResult(loadedResult)
    }
    loadIncoming()
  }, [memberId, incomingReload])

  useEffect(() => {
    if (memberId === '') { return }
    async function loadOutgoing() {
      const loadedResult = await sendGetMyRequestsRequest(memberId)
      setOutgoingResult(loadedResult)
    }
    loadOutgoing()
  }, [memberId, outgoingReload])

  useEffect(() => {
    if (memberId === '') { return }
    async function loadHistory() {
      const loadedResult = await sendGetExchangeHistoryRequest(memberId)
      setHistoryResult(loadedResult)
    }
    loadHistory()
  }, [memberId, historyReload])

  async function handleDecision(claimId: string, decision: string) {
    if (decisionInFlightRef.current === claimId) { return }
    decisionInFlightRef.current = claimId

    let confirmMessage = 'Approve this request? This is final.'
    if (decision === 'deny') {
      confirmMessage = 'Deny this request? This is final.'
    }
    const confirmed = window.confirm(confirmMessage)
    if (confirmed === false) {
      if (decisionInFlightRef.current === claimId) { decisionInFlightRef.current = '' }
      return
    }

    setDecidingClaimId(claimId)
    const decisionResult = await sendDecideClaimRequest(memberId, claimId, decision)

    if (decisionInFlightRef.current === claimId) { decisionInFlightRef.current = '' }
    setDecidingClaimId('')

    if (decisionResult.errorMessage !== '') {
      window.alert(decisionResult.errorMessage)
      return
    }
    if (decisionResult.ok === false) {
      let detailMessage = 'Could not update the request. Please try again.'
      if (typeof decisionResult.data === 'object' && decisionResult.data !== null) {
        const dataObject = decisionResult.data as { detail?: unknown }
        if (typeof dataObject.detail === 'string') { detailMessage = dataObject.detail }
      }
      window.alert(detailMessage)
      return
    }
    setIncomingReload((currentValue) => currentValue + 1)
  }

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

    if (withdrawResult.errorMessage !== '') {
      window.alert(withdrawResult.errorMessage)
      return
    }
    if (withdrawResult.ok === false) {
      let detailMessage = 'Could not withdraw the request. Please try again.'
      if (typeof withdrawResult.data === 'object' && withdrawResult.data !== null) {
        const dataObject = withdrawResult.data as { detail?: unknown }
        if (typeof dataObject.detail === 'string') { detailMessage = dataObject.detail }
      }
      window.alert(detailMessage)
      return
    }
    setOutgoingReload((currentValue) => currentValue + 1)
  }

  // Confirm pickup on an approved exchange-history row where the caller is the
  // recipient. Same shape as the withdraw handler: a same-tick double-click
  // guard, a confirm, the call, then the result handling. On success the
  // history reloads, so the row moves from Needs you to In progress (it is now
  // picked_up on the recipient side, waiting on the poster).
  async function handleConfirmPickup(claimId: string) {
    if (pickupInFlightRef.current === claimId) { return }
    pickupInFlightRef.current = claimId

    const confirmed = window.confirm('Confirm that you picked up this item? This cannot be undone.')
    if (confirmed === false) {
      if (pickupInFlightRef.current === claimId) { pickupInFlightRef.current = '' }
      return
    }

    setConfirmingPickupClaimId(claimId)
    const pickupResult = await sendConfirmPickupRequest(memberId, claimId)
    if (pickupInFlightRef.current === claimId) { pickupInFlightRef.current = '' }
    setConfirmingPickupClaimId('')

    if (pickupResult.errorMessage !== '') {
      window.alert(pickupResult.errorMessage)
      return
    }
    if (pickupResult.ok === false) {
      let detailMessage = 'Could not confirm pickup. Please try again.'
      if (typeof pickupResult.data === 'object' && pickupResult.data !== null) {
        const dataObject = pickupResult.data as { detail?: unknown }
        if (typeof dataObject.detail === 'string') { detailMessage = dataObject.detail }
      }
      window.alert(detailMessage)
      return
    }
    setHistoryReload((currentValue) => currentValue + 1)
  }

  // Mark a picked-up exchange complete on a history row where the caller is
  // the poster. On success the history reloads, so the row moves from Needs
  // you to Finished.
  async function handleCompleteExchange(claimId: string) {
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

    if (completeResult.errorMessage !== '') {
      window.alert(completeResult.errorMessage)
      return
    }
    if (completeResult.ok === false) {
      let detailMessage = 'Could not complete the exchange. Please try again.'
      if (typeof completeResult.data === 'object' && completeResult.data !== null) {
        const dataObject = completeResult.data as { detail?: unknown }
        if (typeof dataObject.detail === 'string') { detailMessage = dataObject.detail }
      }
      window.alert(detailMessage)
      return
    }
    setHistoryReload((currentValue) => currentValue + 1)
  }

  const timeZoneNote = getLocalTimeZoneNote()

  // --- Quick actions --------------------------------------------------------
  const quickActions = (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
      <Link to="/browse" className="flex flex-col items-center gap-2 p-4 bg-surface rounded-xl border border-border shadow-sm hover:shadow-md hover:border-primary-200 transition-all duration-200 group">
        <span aria-hidden="true" className="text-2xl group-hover:scale-110 transition-transform">🔍</span>
        <span className="text-xs font-medium text-text-muted group-hover:text-primary-600">Browse</span>
      </Link>
      <Link to="/listings/create" className="flex flex-col items-center gap-2 p-4 bg-surface rounded-xl border border-border shadow-sm hover:shadow-md hover:border-primary-200 transition-all duration-200 group">
        <span aria-hidden="true" className="text-2xl group-hover:scale-110 transition-transform">➕</span>
        <span className="text-xs font-medium text-text-muted group-hover:text-primary-600">New Listing</span>
      </Link>
      <Link to="/invite" className="flex flex-col items-center gap-2 p-4 bg-surface rounded-xl border border-border shadow-sm hover:shadow-md hover:border-primary-200 transition-all duration-200 group">
        <span aria-hidden="true" className="text-2xl group-hover:scale-110 transition-transform">💌</span>
        <span className="text-xs font-medium text-text-muted group-hover:text-primary-600">Invite</span>
      </Link>
      <Link to="/requests" className="flex flex-col items-center gap-2 p-4 bg-surface rounded-xl border border-border shadow-sm hover:shadow-md hover:border-primary-200 transition-all duration-200 group">
        <span aria-hidden="true" className="text-2xl group-hover:scale-110 transition-transform">📥</span>
        <span className="text-xs font-medium text-text-muted group-hover:text-primary-600">Incoming Requests</span>
      </Link>
      <Link to="/notifications" className="flex flex-col items-center gap-2 p-4 bg-surface rounded-xl border border-border shadow-sm hover:shadow-md hover:border-primary-200 transition-all duration-200 group">
        <span aria-hidden="true" className="text-2xl group-hover:scale-110 transition-transform">🔔</span>
        <span className="text-xs font-medium text-text-muted group-hover:text-primary-600">Notifications</span>
      </Link>
    </div>
  )

  // --- Latest Community Listings preview ------------------------------------
  let previewArea
  if (memberId === '') {
    previewArea = null
  } else if (previewResult === null) {
    previewArea = <p className="text-sm text-text-muted">Loading latest listings...</p>
  } else if (previewResult.errorMessage !== '') {
    previewArea = <p className="text-sm text-error" role="alert">{previewResult.errorMessage}</p>
  } else if (previewResult.ok) {
    const listings = previewResult.data as ListingDetail[]
    if (listings.length === 0) {
      previewArea = <p className="text-sm text-text-muted">No listings yet.</p>
    } else {
      const previewItems = []
      for (let index = 0; index < listings.length; index = index + 1) {
        const listing = listings[index]
        const postedText = formatTimestamp(listing.created_at)
        previewItems.push(
          <li key={listing.id} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
            <Link to={'/listings/' + listing.id} className="text-sm font-medium text-text hover:text-primary-600 transition-colors truncate">
              {listing.title}
            </Link>
            <span className="text-xs text-text-muted shrink-0 ml-3">{postedText}</span>
          </li>,
        )
      }
      previewArea = (
        <>
          <ul>{previewItems}</ul>
          <Link to="/browse" className="mt-3 inline-flex items-center text-sm font-medium text-primary-600 hover:text-primary-700">
            Browse all →
          </Link>
        </>
      )
    }
  } else {
    previewArea = <p className="text-sm text-error" role="alert">Could not load the latest listings.</p>
  }

  // --- My Active Listings section -------------------------------------------
  let myActiveArea
  if (myListingsResult === null) {
    myActiveArea = <p className="text-sm text-text-muted">Loading your active listings...</p>
  } else if (myListingsResult.errorMessage !== '') {
    myActiveArea = <p className="text-sm text-error" role="alert">{myListingsResult.errorMessage}</p>
  } else if (myListingsResult.ok) {
    const listings = myListingsResult.data as ListingDetail[]
    const activeRows = []
    for (let index = 0; index < listings.length; index = index + 1) {
      const listing = listings[index]
      if (listing.status !== 'active') { continue }
      const postedText = formatTimestamp(listing.created_at)
      activeRows.push(
        <li key={listing.id} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
          <div className="flex items-center gap-3 min-w-0">
            <Link to={'/listings/' + listing.id} className="text-sm font-medium text-text hover:text-primary-600 transition-colors truncate">
              {listing.title}
            </Link>
            <span className="text-xs text-text-muted shrink-0">{postedText}</span>
          </div>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 shrink-0 ml-3">
            {listing.remaining_quantity} left
          </span>
        </li>,
      )
    }
    if (activeRows.length === 0) {
      myActiveArea = <p className="text-sm text-text-muted">You have no active listings.</p>
    } else {
      myActiveArea = <ul>{activeRows}</ul>
    }
  } else {
    myActiveArea = <p className="text-sm text-error" role="alert">Could not load your active listings.</p>
  }

  function buildIncomingGroup(group: ListingQueueGroup) {
    // The listing title links to its own page. Same rule as the requests and
    // my-requests pages: only an active listing has a page to show, so a
    // deactivated one stays plain text and keeps its marker in the same text
    // node (a separate span would drop the space before "(deactivated)" when a
    // screen reader reads the heading). The link carries the dashboard's own
    // link colors, dark text that turns primary on hover, so it matches the
    // listing links in the two boxes above.
    let titleNode = (
      <Link to={'/listings/' + group.listing_id} className="text-text hover:text-primary-600 transition-colors">
        {group.listing_title}
      </Link>
    )
    if (group.listing_status === 'deactivated') {
      titleNode = <>{group.listing_title + ' (deactivated)'}</>
    }
    const rowItems = []
    for (let index = 0; index < group.pending.length; index = index + 1) {
      const item = group.pending[index]
      const requestedAtText = formatTimestamp(item.requested_at)
      const isThisRowPending = decidingClaimId === item.id

      let approveButton = null
      if (item.can_decide === true) {
        approveButton = (
          <button
            type="button"
            disabled={isThisRowPending}
            onClick={() => handleDecision(item.id, 'approve')}
            className="inline-flex items-center px-3 py-1 text-xs font-medium text-success border border-green-200 rounded-md hover:bg-success-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Approve
          </button>
        )
      }
      let denyButton = null
      if (item.can_deny === true) {
        denyButton = (
          <button
            type="button"
            disabled={isThisRowPending}
            onClick={() => handleDecision(item.id, 'deny')}
            className="inline-flex items-center px-3 py-1 text-xs font-medium text-error border border-red-200 rounded-md hover:bg-error-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Deny
          </button>
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
      rowItems.push(
        <li key={item.id} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
          <div className="min-w-0">
            <p className="text-sm text-text">
              {item.claimant_name}{' '}
              <MemberRatingChip
                memberId={item.claimant_id}
                role="requestor"
                average={claimantRequestorAverage}
                count={claimantRequestorCount}
              />{' '}
              requested {item.requested_quantity}
            </p>
            <p className="text-xs text-text-muted">{requestedAtText}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-3">
            {approveButton}
            {denyButton}
          </div>
        </li>,
      )
    }
    return (
      <article key={group.listing_id} className="mb-4">
        <h3 className="text-sm font-semibold text-text mb-2">{titleNode}</h3>
        <ul>{rowItems}</ul>
      </article>
    )
  }

  // --- Incoming requests section --------------------------------------------
  let incomingArea
  if (incomingResult === null) {
    incomingArea = <p className="text-sm text-text-muted">Loading incoming requests...</p>
  } else if (incomingResult.errorMessage !== '') {
    incomingArea = <p className="text-sm text-error" role="alert">{incomingResult.errorMessage}</p>
  } else if (incomingResult.ok) {
    const responseData = incomingResult.data as RequestQueuesResponse
    const groups = responseData.groups
    if (groups.length === 0) {
      incomingArea = <p className="text-sm text-text-muted">No incoming requests.</p>
    } else {
      const groupViews = []
      for (let index = 0; index < groups.length; index = index + 1) {
        groupViews.push(buildIncomingGroup(groups[index]))
      }
      incomingArea = <div>{groupViews}</div>
    }
  } else {
    incomingArea = <p className="text-sm text-error" role="alert">Could not load incoming requests.</p>
  }

  // --- Outgoing requests section --------------------------------------------
  let outgoingArea
  if (outgoingResult === null) {
    outgoingArea = <p className="text-sm text-text-muted">Loading outgoing requests...</p>
  } else if (outgoingResult.errorMessage !== '') {
    outgoingArea = <p className="text-sm text-error" role="alert">{outgoingResult.errorMessage}</p>
  } else if (outgoingResult.ok) {
    const responseData = outgoingResult.data as MyRequestsResponse
    const pending = responseData.pending
    if (pending.length === 0) {
      outgoingArea = <p className="text-sm text-text-muted">You have no pending requests.</p>
    } else {
      const outgoingRows = []
      for (let index = 0; index < pending.length; index = index + 1) {
        const item = pending[index]
        const requestedAtText = formatTimestamp(item.requested_at)
        const isThisRowPending = withdrawingClaimId === item.id
        // Same linking rule as the incoming groups above: an active listing's
        // title links to its page, a deactivated one stays plain text.
        let outgoingTitleNode = <>{item.listing_title}</>
        if (item.listing_status !== 'deactivated') {
          outgoingTitleNode = (
            <Link to={'/listings/' + item.listing_id} className="text-text hover:text-primary-600 transition-colors">
              {item.listing_title}
            </Link>
          )
        }
        outgoingRows.push(
          <li key={item.id} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
            <div className="min-w-0">
              <p className="text-sm text-text">{outgoingTitleNode}: requested <span className="font-medium">{item.requested_quantity}</span></p>
              <p className="text-xs text-text-muted">{requestedAtText}</p>
            </div>
            <button
              type="button"
              disabled={isThisRowPending}
              onClick={() => handleWithdraw(item.id)}
              className="inline-flex items-center px-3 py-1 text-xs font-medium text-text-muted border border-border rounded-md hover:bg-background-alt hover:text-text transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 ml-3"
            >
              Withdraw
            </button>
          </li>,
        )
      }
      outgoingArea = <ul>{outgoingRows}</ul>
    }
  } else {
    outgoingArea = <p className="text-sm text-error" role="alert">Could not load outgoing requests.</p>
  }

  // --- Exchange History section (US-24) --------------------------------------

  // Which tab a history row lands in, from its status and the caller's side.
  // Across the three open statuses exactly one side must act each time: the
  // poster decides a requested row, the recipient confirms pickup on an
  // approved row, and the poster completes a picked-up row. The three terminal
  // statuses need nobody, so they are all Finished.
  function getHistoryTab(item: ExchangeHistoryItem) {
    if (item.status === 'requested') {
      if (item.side === 'poster') { return 'needs_you' }
      return 'in_progress'
    }
    if (item.status === 'approved') {
      if (item.side === 'recipient') { return 'needs_you' }
      return 'in_progress'
    }
    if (item.status === 'picked_up') {
      if (item.side === 'poster') { return 'needs_you' }
      return 'in_progress'
    }
    return 'finished'
  }

  // The muted second line: the status and the time the row entered it, read
  // from the timestamp column that matches the status.
  function getHistoryStatusLine(item: ExchangeHistoryItem) {
    if (item.status === 'requested') {
      return 'Requested ' + formatTimestamp(item.requested_at)
    }
    if (item.status === 'approved') {
      let timeText = ''
      if (item.approved_at !== null) { timeText = formatTimestamp(item.approved_at) }
      return 'Approved ' + timeText
    }
    if (item.status === 'picked_up') {
      let timeText = ''
      if (item.picked_up_at !== null) { timeText = formatTimestamp(item.picked_up_at) }
      return 'Picked up ' + timeText
    }
    if (item.status === 'completed') {
      let timeText = ''
      if (item.completed_at !== null) { timeText = formatTimestamp(item.completed_at) }
      return 'Completed ' + timeText
    }
    if (item.status === 'cancelled') {
      let timeText = ''
      if (item.cancelled_at !== null) { timeText = formatTimestamp(item.cancelled_at) }
      return 'Cancelled ' + timeText
    }
    let timeText = ''
    if (item.denied_at !== null) { timeText = formatTimestamp(item.denied_at) }
    return 'Denied ' + timeText
  }

  // One history row: the listing link, the quantity, the other party worded by
  // side, the status line, and the right-hand control or hint the status and
  // side call for.
  function buildHistoryRow(item: ExchangeHistoryItem) {
    let quantity = item.requested_quantity
    if (item.approved_quantity !== null) { quantity = item.approved_quantity }

    // The other party, worded by side: the recipient got the item "from" the
    // owner; the poster gives it "for" the claimant.
    let partyText = ''
    if (item.other_party_name !== '') {
      if (item.side === 'recipient') {
        partyText = ' from ' + item.other_party_name
      } else {
        partyText = ' for ' + item.other_party_name
      }
    }

    // The exchange-thread link, for both sides, but only once the poster has
    // approved (approved or picked_up). A requested row has no exchange to
    // arrange yet, and the requests and my-requests pages drop the link on
    // finished rows, so this section does too. Target, wording, and styling
    // are copied from those two pages: "Arrange the Exchange" while the
    // pickup is being arranged, then the contact wording by side after
    // pickup. It is a plain navigation link with no request in flight, and
    // the thread backend admits only the listing owner and the claimant.
    const threadLinkClasses = 'inline-flex items-center px-3 py-1.5 text-xs font-medium text-primary-600 border border-primary-200 rounded-md hover:bg-primary-50 transition-colors'
    let threadLink = null
    if (item.status === 'approved') {
      threadLink = (
        <Link to={'/exchange-thread?claim=' + item.id} className={threadLinkClasses}>
          Arrange the Exchange
        </Link>
      )
    } else if (item.status === 'picked_up') {
      if (item.side === 'recipient') {
        threadLink = (
          <Link to={'/exchange-thread?claim=' + item.id} className={threadLinkClasses}>
            Contact the Poster
          </Link>
        )
      } else {
        threadLink = (
          <Link to={'/exchange-thread?claim=' + item.id} className={threadLinkClasses}>
            Contact the Recipient
          </Link>
        )
      }
    }

    // The right-hand slot by status and side: the recipient's Confirm pickup
    // button on an approved row, the poster's Mark exchange complete button
    // on a picked-up row, the poster's link to the requests page on a
    // requested row (Approve and Deny live there), or a muted waiting hint on
    // the other open rows. Approved and picked-up rows also carry the thread
    // link built above, on both sides. Finished rows get nothing.
    let rightArea = null
    if (item.status === 'approved' && item.side === 'recipient') {
      const isThisRowConfirming = confirmingPickupClaimId === item.id
      rightArea = (
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {threadLink}
          <button
            type="button"
            disabled={isThisRowConfirming}
            onClick={() => handleConfirmPickup(item.id)}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-primary-600 border border-primary-200 rounded-md hover:bg-primary-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm pickup
          </button>
        </div>
      )
    } else if (item.status === 'picked_up' && item.side === 'poster') {
      const isThisRowCompleting = completingClaimId === item.id
      rightArea = (
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {threadLink}
          <button
            type="button"
            disabled={isThisRowCompleting}
            onClick={() => handleCompleteExchange(item.id)}
            className="inline-flex items-center px-3 py-1 text-xs font-medium text-primary-700 border border-border rounded-md hover:bg-primary-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Mark exchange complete
          </button>
        </div>
      )
    } else if (item.status === 'requested' && item.side === 'poster') {
      rightArea = (
        <Link to={'/requests?listing=' + item.listing_id} className="text-xs shrink-0 ml-3">
          Review this request
        </Link>
      )
    } else if (item.status === 'approved' || item.status === 'picked_up') {
      rightArea = (
        <div className="flex items-center gap-2 shrink-0 ml-3">
          <span className="text-xs text-text-muted">
            Waiting on {item.other_party_name}
          </span>
          {threadLink}
        </div>
      )
    } else if (item.status === 'requested') {
      rightArea = (
        <span className="text-xs text-text-muted shrink-0 ml-3">
          Waiting on {item.other_party_name}
        </span>
      )
    }

    return (
      <li key={item.id} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
        <div className="min-w-0">
          <p className="text-sm text-text">
            <Link to={'/listings/' + item.listing_id}>{item.listing_title}</Link>
            {' '}({quantity}){partyText}
          </p>
          <p className="text-xs text-text-muted">{getHistoryStatusLine(item)}</p>
        </div>
        {rightArea}
      </li>
    )
  }

  // One status subheading inside a tab panel. An empty subheading still
  // renders, with "Nothing here yet." underneath, so a member with no
  // activity sees every group (Scenario 2) and the panel height stays stable.
  function buildHistoryStatusGroup(
    tabKey: string,
    statusLabel: string,
    items: ExchangeHistoryItem[],
  ) {
    const rows = []
    for (let index = 0; index < items.length; index = index + 1) {
      const item = items[index]
      if (getHistoryTab(item) !== tabKey) { continue }
      rows.push(buildHistoryRow(item))
    }
    let bodyArea
    if (rows.length === 0) {
      bodyArea = <p className="text-xs text-text-muted">Nothing here yet.</p>
    } else {
      bodyArea = <ul>{rows}</ul>
    }
    return (
      <div key={statusLabel} className="mb-4 last:mb-0">
        <h3 className="text-sm font-semibold text-text mb-2">{statusLabel}</h3>
        {bodyArea}
      </div>
    )
  }

  let historyArea
  if (memberId === '') {
    historyArea = null
  } else if (historyResult === null) {
    historyArea = <p className="text-sm text-text-muted">Loading exchange history...</p>
  } else if (historyResult.errorMessage !== '') {
    historyArea = <p className="text-sm text-error" role="alert">{historyResult.errorMessage}</p>
  } else if (historyResult.ok) {
    const historyData = historyResult.data as ExchangeHistoryResponse

    // Count the rows per tab for the tab labels. Every row of the six groups
    // lands in exactly one tab.
    const allItems = []
    for (let index = 0; index < historyData.requested.length; index = index + 1) {
      allItems.push(historyData.requested[index])
    }
    for (let index = 0; index < historyData.approved.length; index = index + 1) {
      allItems.push(historyData.approved[index])
    }
    for (let index = 0; index < historyData.picked_up.length; index = index + 1) {
      allItems.push(historyData.picked_up[index])
    }
    for (let index = 0; index < historyData.completed.length; index = index + 1) {
      allItems.push(historyData.completed[index])
    }
    for (let index = 0; index < historyData.cancelled.length; index = index + 1) {
      allItems.push(historyData.cancelled[index])
    }
    for (let index = 0; index < historyData.denied.length; index = index + 1) {
      allItems.push(historyData.denied[index])
    }
    let needsYouCount = 0
    let inProgressCount = 0
    let finishedCount = 0
    for (let index = 0; index < allItems.length; index = index + 1) {
      const tabKey = getHistoryTab(allItems[index])
      if (tabKey === 'needs_you') {
        needsYouCount = needsYouCount + 1
      } else if (tabKey === 'in_progress') {
        inProgressCount = inProgressCount + 1
      } else {
        finishedCount = finishedCount + 1
      }
    }

    // The Needs you count is the only one that means the member has work, so
    // it gets a filled accent badge while it holds rows; at zero it goes muted
    // like the other two.
    const mutedBadgeClasses = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ml-1.5 bg-background-alt text-text-muted'
    let needsYouBadgeClasses = mutedBadgeClasses
    if (needsYouCount > 0) {
      needsYouBadgeClasses = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ml-1.5 bg-primary-50 text-primary-700'
    }

    // The active tab gets the accent underline and text; the rest stay muted
    // with a transparent underline so nothing shifts when the tab changes.
    const activeTabClasses = 'pb-2 -mb-px border-b-2 border-primary-600 text-sm font-medium text-primary-700'
    const inactiveTabClasses = 'pb-2 -mb-px border-b-2 border-transparent text-sm font-medium text-text-muted'
    let needsYouTabClasses = inactiveTabClasses
    if (activeHistoryTab === 'needs_you') { needsYouTabClasses = activeTabClasses }
    let inProgressTabClasses = inactiveTabClasses
    if (activeHistoryTab === 'in_progress') { inProgressTabClasses = activeTabClasses }
    let finishedTabClasses = inactiveTabClasses
    if (activeHistoryTab === 'finished') { finishedTabClasses = activeTabClasses }

    historyArea = (
      <>
        <div role="tablist" className="flex items-center gap-6 border-b border-border mt-3 mb-4">
          <button
            type="button"
            role="tab"
            id="history-tab-needs-you"
            aria-selected={activeHistoryTab === 'needs_you'}
            aria-controls="history-panel-needs-you"
            onClick={() => setActiveHistoryTab('needs_you')}
            className={needsYouTabClasses}
          >
            Needs you
            <span className={needsYouBadgeClasses}>{needsYouCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            id="history-tab-in-progress"
            aria-selected={activeHistoryTab === 'in_progress'}
            aria-controls="history-panel-in-progress"
            onClick={() => setActiveHistoryTab('in_progress')}
            className={inProgressTabClasses}
          >
            In progress
            <span className={mutedBadgeClasses}>{inProgressCount}</span>
          </button>
          <button
            type="button"
            role="tab"
            id="history-tab-finished"
            aria-selected={activeHistoryTab === 'finished'}
            aria-controls="history-panel-finished"
            onClick={() => setActiveHistoryTab('finished')}
            className={finishedTabClasses}
          >
            Finished
            <span className={mutedBadgeClasses}>{finishedCount}</span>
          </button>
        </div>
        <div
          role="tabpanel"
          id="history-panel-needs-you"
          aria-labelledby="history-tab-needs-you"
          hidden={activeHistoryTab !== 'needs_you'}
        >
          {buildHistoryStatusGroup('needs_you', 'Requested', historyData.requested)}
          {buildHistoryStatusGroup('needs_you', 'Approved', historyData.approved)}
          {buildHistoryStatusGroup('needs_you', 'Picked up', historyData.picked_up)}
        </div>
        <div
          role="tabpanel"
          id="history-panel-in-progress"
          aria-labelledby="history-tab-in-progress"
          hidden={activeHistoryTab !== 'in_progress'}
        >
          {buildHistoryStatusGroup('in_progress', 'Requested', historyData.requested)}
          {buildHistoryStatusGroup('in_progress', 'Approved', historyData.approved)}
          {buildHistoryStatusGroup('in_progress', 'Picked up', historyData.picked_up)}
        </div>
        <div
          role="tabpanel"
          id="history-panel-finished"
          aria-labelledby="history-tab-finished"
          hidden={activeHistoryTab !== 'finished'}
        >
          {buildHistoryStatusGroup('finished', 'Completed', historyData.completed)}
          {buildHistoryStatusGroup('finished', 'Cancelled', historyData.cancelled)}
          {buildHistoryStatusGroup('finished', 'Denied', historyData.denied)}
        </div>
      </>
    )
  } else {
    historyArea = <p className="text-sm text-error" role="alert">Could not load your exchange history.</p>
  }

  // The greeting shown at the top of the page.
  let greetingName = 'there'
  if (memberName !== '') {
    greetingName = memberName
  }

  return (
    <section>
      <h1 className="text-3xl font-bold text-text mb-2">
        Welcome back, {greetingName} 👋
      </h1>
      <p className="text-sm text-text-muted mb-6">{timeZoneNote}</p>

      {quickActions}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Latest Community Listings */}
        <div className="bg-surface rounded-xl border border-border p-6 shadow-sm">
          <h2 className="text-base font-semibold text-text mb-4">Latest Community Listings</h2>
          {previewArea}
        </div>

        {/* My Active Listings. The See-all link sits outside the loading and
            error branches so the page always offers the way to the full list. */}
        <div className="bg-surface rounded-xl border border-border p-6 shadow-sm">
          <h2 className="text-base font-semibold text-text mb-4">My Active Listings</h2>
          {myActiveArea}
          <Link to="/my-listings" className="mt-3 inline-flex items-center text-sm font-medium text-primary-600 hover:text-primary-700">
            See all listings →
          </Link>
        </div>

        {/* Incoming Request Queue */}
        <div className="bg-surface rounded-xl border border-border p-6 shadow-sm">
          <h2 className="text-base font-semibold text-text mb-4">Incoming Requests</h2>
          {incomingArea}
          <Link to="/requests" className="mt-3 inline-flex items-center text-sm font-medium text-primary-600 hover:text-primary-700">
            See all incoming →
          </Link>
        </div>

        {/* My Requests to Others */}
        <div className="bg-surface rounded-xl border border-border p-6 shadow-sm">
          <h2 className="text-base font-semibold text-text mb-4">My Requests to Others</h2>
          {outgoingArea}
          <Link to="/my-requests" className="mt-3 inline-flex items-center text-sm font-medium text-primary-600 hover:text-primary-700">
            See all my requests →
          </Link>
        </div>
      </div>

      {/* Exchange History (US-24): the member's exchanges on both sides,
          split into three tabs by who must act next, with the claim statuses
          as subheadings inside each tab. A requested row also appearing on a
          request card above is deliberate: this section is the full record,
          while the cards stay the place pending work is acted on. */}
      <div className="bg-surface rounded-xl border border-border p-6 shadow-sm mt-6">
        <h2 className="text-base font-semibold text-text mb-1">Exchange History</h2>
        {historyArea}
      </div>
    </section>
  )
}

export default DashboardPage
