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
    let titleText = group.listing_title
    if (group.listing_status === 'deactivated') {
      titleText = group.listing_title + ' (deactivated)'
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
      rowItems.push(
        <li key={item.id} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
          <div className="min-w-0">
            <p className="text-sm text-text">{item.claimant_name} requested {item.requested_quantity}</p>
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
        <h3 className="text-sm font-semibold text-text mb-2">{titleText}</h3>
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
        outgoingRows.push(
          <li key={item.id} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
            <div className="min-w-0">
              <p className="text-sm text-text">{item.listing_title}: requested <span className="font-medium">{item.requested_quantity}</span></p>
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

      {/* Exchange History: placeholder until the exchange-history feature is
          built. Static markup, no fetch: one subheading per claim status in
          lifecycle order. */}
      <div className="bg-surface rounded-xl border border-border p-6 shadow-sm mt-6">
        <h2 className="text-base font-semibold text-text mb-1">Exchange History</h2>
        <p className="text-sm text-text-muted mb-4">Exchange history is not available yet.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="rounded-lg bg-background-alt px-4 py-3">
            <h3 className="text-sm font-semibold text-text">Requested</h3>
            <p className="text-xs text-text-muted mt-0.5">Nothing here yet.</p>
          </div>
          <div className="rounded-lg bg-background-alt px-4 py-3">
            <h3 className="text-sm font-semibold text-text">Approved</h3>
            <p className="text-xs text-text-muted mt-0.5">Nothing here yet.</p>
          </div>
          <div className="rounded-lg bg-background-alt px-4 py-3">
            <h3 className="text-sm font-semibold text-text">Picked up</h3>
            <p className="text-xs text-text-muted mt-0.5">Nothing here yet.</p>
          </div>
          <div className="rounded-lg bg-background-alt px-4 py-3">
            <h3 className="text-sm font-semibold text-text">Completed</h3>
            <p className="text-xs text-text-muted mt-0.5">Nothing here yet.</p>
          </div>
          <div className="rounded-lg bg-background-alt px-4 py-3">
            <h3 className="text-sm font-semibold text-text">Cancelled</h3>
            <p className="text-xs text-text-muted mt-0.5">Nothing here yet.</p>
          </div>
          <div className="rounded-lg bg-background-alt px-4 py-3">
            <h3 className="text-sm font-semibold text-text">Denied</h3>
            <p className="text-xs text-text-muted mt-0.5">Nothing here yet.</p>
          </div>
        </div>
      </div>
    </section>
  )
}

export default DashboardPage
