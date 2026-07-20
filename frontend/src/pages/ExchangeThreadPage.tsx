import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'

import { getThread, sendMessage } from '../services/threadService'
import type { MessageData, ThreadData } from '../services/threadService'
import {
  sendCompleteExchangeRequest,
  sendConfirmPickupRequest,
} from '../services/requestQueueService'
import { authStateChangedEventName } from '../services/authService'
import { formatTimestamp, getLocalTimeZoneNote } from '../utils/formatTimestamp'

const notLoggedInMessage = 'You need to be logged in to view this exchange thread.'
const MESSAGE_MAX_LENGTH = 2000

function ExchangeThreadPage() {
  const location = useLocation()
  const claimId = new URLSearchParams(location.search).get('claim') ?? ''

  const latestRequestNumber = useRef(0)
  const [memberId] = useState(window.localStorage.getItem('memberId') ?? '')
  const [thread, setThread] = useState<ThreadData | null>(null)
  const [loadError, setLoadError] = useState('')
  const [reloadCounter, setReloadCounter] = useState(0)

  const [messageBody, setMessageBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')

  // Workflow actions offered inside the thread: the requester confirms the
  // pickup while the exchange is approved, and the poster marks it complete
  // once picked up. Same guards as My Requests and Incoming Requests: a ref
  // blocks a same-tick double click before the dialog opens, and the busy
  // flag disables the button while the call runs.
  const pickupInFlightRef = useRef(false)
  const [confirmingPickup, setConfirmingPickup] = useState(false)
  const completeInFlightRef = useRef(false)
  const [completingExchange, setCompletingExchange] = useState(false)

  // Load the thread whenever the page mounts or a message is sent.
  useEffect(() => {
    latestRequestNumber.current = latestRequestNumber.current + 1
    if (memberId === '' || claimId === '') {
      return
    }
    const requestNumber = latestRequestNumber.current
    async function loadThread() {
      const result = await getThread(memberId, claimId)
      if (requestNumber !== latestRequestNumber.current) {
        return
      }
      if (result.status === 401) {
        window.localStorage.removeItem('memberId')
        window.localStorage.removeItem('memberName')
        window.localStorage.removeItem('memberEmail')
        window.dispatchEvent(new Event(authStateChangedEventName))
        return
      }
      if (result.errorMessage !== '') {
        setLoadError(result.errorMessage)
        return
      }
      if (result.ok) {
        setThread(result.data as ThreadData)
        setLoadError('')
      } else {
        let detail = 'Could not load this exchange thread. Please try again.'
        if (typeof result.data === 'object' && result.data !== null) {
          const d = result.data as { detail?: unknown }
          if (typeof d.detail === 'string') detail = d.detail
        }
        setLoadError(detail)
      }
    }
    loadThread()
  }, [memberId, claimId, reloadCounter])

  async function handleSend(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = messageBody.trim()
    if (trimmed === '') {
      setSendError('Message cannot be empty.')
      return
    }
    setSending(true)
    setSendError('')

    const result = await sendMessage(memberId, claimId, trimmed)
    setSending(false)

    if (result.errorMessage !== '') {
      setSendError(result.errorMessage)
      return
    }
    if (result.ok) {
      setMessageBody('')
      setReloadCounter((c) => c + 1)
    } else {
      let detail = 'Could not send the message. Please try again.'
      if (typeof result.data === 'object' && result.data !== null) {
        const d = result.data as { detail?: unknown }
        if (typeof d.detail === 'string') detail = d.detail
      }
      setSendError(detail)
    }
  }

  // Confirm pickup on this exchange. Same shape as the handler on My
  // Requests: the double-click guard, a confirm, the call, then the result
  // handling. On success the thread reloads, the status moves to picked up,
  // and the button goes away. The backend is the final gate: it checks the
  // caller is the claimant and the claim is still approved.
  async function handleConfirmPickup() {
    if (pickupInFlightRef.current) {
      return
    }
    pickupInFlightRef.current = true

    const confirmed = window.confirm('Confirm that you picked up this item? This cannot be undone.')
    if (confirmed === false) {
      pickupInFlightRef.current = false
      return
    }

    setConfirmingPickup(true)
    const pickupResult = await sendConfirmPickupRequest(memberId, claimId)
    pickupInFlightRef.current = false
    setConfirmingPickup(false)

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
    setReloadCounter((c) => c + 1)
  }

  // Mark this exchange complete. Same shape as the handler on Incoming
  // Requests: the double-click guard, a confirm, the call, then the result
  // handling. On success the thread reloads as completed, which locks the
  // composer and shows the review button. The backend is the final gate: it
  // checks the caller is the listing owner and the claim is picked up.
  async function handleCompleteExchange() {
    if (completeInFlightRef.current) {
      return
    }
    completeInFlightRef.current = true

    const confirmed = window.confirm('Mark this exchange complete? This is final.')
    if (confirmed === false) {
      completeInFlightRef.current = false
      return
    }

    setCompletingExchange(true)
    const completeResult = await sendCompleteExchangeRequest(memberId, claimId)
    completeInFlightRef.current = false
    setCompletingExchange(false)

    if (completeResult.errorMessage !== '') {
      window.alert(completeResult.errorMessage)
      return
    }
    if (completeResult.ok === false) {
      let detailMessage = 'Could not complete the exchange. Please try again.'
      if (typeof completeResult.data === 'object' && completeResult.data !== null) {
        const dataObject = completeResult.data as { detail?: unknown }
        if (typeof dataObject.detail === 'string') {
          detailMessage = dataObject.detail
        }
      }
      window.alert(detailMessage)
      return
    }
    setReloadCounter((c) => c + 1)
  }

  // Placeholder for the review feature (US-20). The button renders on a
  // completed exchange now so the flow is visible, the same as the completed
  // rows on My Requests and Incoming Requests, but the review form itself is
  // US-20's to build; until then the click explains that.
  function handleLeaveReview() {
    window.alert(
      'Reviews are not built yet. Leaving a rating and review for a completed exchange arrives with user story US-20.',
    )
  }

  // One chat row. The viewer's own messages sit on the right in the primary
  // green; the other member's messages sit on the left in the neutral bubble.
  // The sender name always shows so a reloaded thread stays readable.
  function buildMessage(msg: MessageData) {
    const isOwnMessage = msg.sender_id === memberId
    // Each bubble gets a pointed tail on its bottom corner, the classic chat
    // look: an after: pseudo-element draws a small triangle (a clip-path cut)
    // in the bubble's own color, sticking out from the corner. The corner the
    // tail attaches to stays square (rounded-bl-none / rounded-br-none) and
    // the triangle tucks a few pixels under the bubble, so tail and body meet
    // with no gap. The other member's bubbles point bottom-left; the viewer's
    // own point bottom-right.
    let rowClasses = 'flex flex-col items-start'
    let bubbleClasses =
      "relative max-w-[75%] rounded-2xl rounded-bl-none bg-background-alt px-4 py-2.5 text-sm text-text whitespace-pre-wrap break-words after:content-[''] after:absolute after:bottom-0 after:-left-2 after:h-4 after:w-4 after:bg-background-alt after:[clip-path:polygon(100%_0,100%_100%,0_100%)]"
    if (isOwnMessage) {
      rowClasses = 'flex flex-col items-end'
      bubbleClasses =
        "relative max-w-[75%] rounded-2xl rounded-br-none bg-primary-600 px-4 py-2.5 text-sm text-text-inverse whitespace-pre-wrap break-words after:content-[''] after:absolute after:bottom-0 after:-right-2 after:h-4 after:w-4 after:bg-primary-600 after:[clip-path:polygon(0_0,0_100%,100%_100%)]"
    }
    return (
      <li key={msg.id} className={rowClasses}>
        <p className="text-xs text-text-muted mb-1">
          <span className="font-medium text-text">{msg.sender_name}</span>{' '}
          {formatTimestamp(msg.sent_at)}
        </p>
        <div className={bubbleClasses}>{msg.body}</div>
      </li>
    )
  }

  const timeZoneNote = getLocalTimeZoneNote()

  // The guidance under the heading, tailored to the viewer's role once the
  // thread has loaded. The generic wording covers the loading state and any
  // older response that does not carry the party ids.
  let instructionsText =
    'This is the private conversation for this exchange, between the poster and the requester, to arrange the pickup.'
  if (thread !== null && thread.owner_id !== undefined && thread.owner_id === memberId) {
    instructionsText =
      'This is your private conversation with the requester. You posted this listing, so say where the pickup happens and when you are available within the pickup window, and answer any questions the requester has.'
  } else if (thread !== null && thread.claimant_id !== undefined && thread.claimant_id === memberId) {
    instructionsText =
      'This is your private conversation with the poster. You requested these items, so agree on a pickup time, ask any questions, and after you have the items in hand, confirm the pickup with the button below.'
  }

  let content
  if (memberId === '') {
    content = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
        {notLoggedInMessage}
      </div>
    )
  } else if (claimId === '') {
    content = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
        No exchange specified. Try navigating here from a request page.
      </div>
    )
  } else if (loadError !== '') {
    content = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
        {loadError}
      </div>
    )
  } else if (thread === null) {
    content = <p className="text-text-muted text-sm py-8 text-center">Loading exchange thread...</p>
  } else {
    const messageList =
      thread.messages.length === 0 ? (
        <p className="text-sm text-text-muted py-8 text-center">
          No messages yet. Start the conversation below.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">{thread.messages.map(buildMessage)}</ul>
      )

    // A summary card for the listing this exchange is about, the way order
    // and message pages on marketplace sites lead with the item: cover photo
    // on the left, the linked title, who posted it and when, then a compact
    // fact row for the quantities and the pickup window.
    let listingCard = null
    if (thread.listing_id !== undefined && thread.listing_id !== '') {
      let thumbnailArea = null
      if (thread.photos !== undefined && thread.photos.length > 0) {
        thumbnailArea = (
          <img
            src={'/api/photos/' + thread.photos[0].id}
            alt={thread.listing_title ?? 'Listing photo'}
            loading="lazy"
            className="w-20 h-20 sm:w-24 sm:h-24 object-cover rounded-lg border border-border shrink-0"
          />
        )
      }
      let postedLine = 'Posted'
      if (typeof thread.owner_name === 'string' && thread.owner_name !== '') {
        postedLine = 'Posted by ' + thread.owner_name
      }
      if (thread.listing_created_at !== undefined && thread.listing_created_at !== null) {
        postedLine = postedLine + ' on ' + formatTimestamp(thread.listing_created_at)
      }
      // Who requested the items, mirroring the posted-by line above it.
      let requestedByLine = null
      if (typeof thread.claimant_name === 'string' && thread.claimant_name !== '') {
        requestedByLine = (
          <p className="text-xs text-text-muted mt-0.5">
            Requested by {thread.claimant_name}
          </p>
        )
      }
      const facts = []
      if (thread.requested_quantity !== undefined && thread.requested_quantity !== null) {
        facts.push(
          <p key="requested" className="text-text-muted">
            Requested: <span className="font-medium text-text">{thread.requested_quantity}</span>
          </p>,
        )
      }
      if (thread.approved_quantity !== undefined && thread.approved_quantity !== null) {
        facts.push(
          <p key="approved" className="text-text-muted">
            Approved: <span className="font-medium text-text">{thread.approved_quantity}</span>
          </p>,
        )
      }
      if (
        thread.pickup_start !== undefined && thread.pickup_start !== null &&
        thread.pickup_end !== undefined && thread.pickup_end !== null
      ) {
        facts.push(
          <p key="pickup" className="text-text-muted">
            Pickup:{' '}
            <span className="font-medium text-text">
              {formatTimestamp(thread.pickup_start)} — {formatTimestamp(thread.pickup_end)}
            </span>
          </p>,
        )
      }
      listingCard = (
        <div className="bg-surface rounded-xl border border-border p-6 shadow-sm mb-6">
          <div className="flex items-start gap-4">
            {thumbnailArea}
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold text-text">
                <Link
                  to={'/listings/' + thread.listing_id}
                  className="hover:text-primary-600 transition-colors"
                >
                  {thread.listing_title}
                </Link>
              </h2>
              <p className="text-xs text-text-muted mt-0.5">{postedLine}</p>
              {requestedByLine}
              {facts.length > 0 && (
                <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-sm">{facts}</div>
              )}
            </div>
          </div>
        </div>
      )
    }

    // When the poster has marked this exchange complete, the thread is locked:
    // a banner says who completed it, the composer below stays visible but
    // disabled (the backend also refuses new messages), and the viewer can
    // review the other party instead. Only the listing owner can complete an
    // exchange, so the completer named here is always the owner.
    const exchangeIsComplete = thread.claim_status === 'completed'
    let completedBanner = null
    if (exchangeIsComplete) {
      let completerName = 'the poster'
      if (typeof thread.owner_name === 'string' && thread.owner_name !== '') {
        completerName = thread.owner_name
      }
      // The review goes to the OTHER party: the poster reviews the requester
      // and the requester reviews the poster, the same rule the completed rows
      // on My Requests and Incoming Requests use. The form itself is US-20's
      // (see handleLeaveReview).
      let reviewTargetFirstName = 'the poster'
      if (thread.owner_id !== undefined && thread.owner_id === memberId) {
        reviewTargetFirstName = 'the recipient'
        if (typeof thread.claimant_name === 'string' && thread.claimant_name !== '') {
          reviewTargetFirstName = thread.claimant_name.split(' ')[0]
        }
      } else {
        if (typeof thread.owner_name === 'string' && thread.owner_name !== '') {
          reviewTargetFirstName = thread.owner_name.split(' ')[0]
        }
      }
      completedBanner = (
        <div className="rounded-lg bg-success-bg border border-green-200 px-4 py-3 mb-4">
          <p className="text-sm font-medium text-success">
            This exchange was marked complete by {completerName}.
          </p>
          <p className="text-sm text-text-muted mt-1">
            The thread is locked, so no new messages can be sent.
          </p>
          <div className="mt-3">
            <button
              type="button"
              onClick={() => handleLeaveReview()}
              className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-primary-600 border border-primary-200 rounded-md hover:bg-primary-50 transition-colors"
            >
              Leave a Review for {reviewTargetFirstName}
            </button>
          </div>
        </div>
      )
    }

    // A cancelled exchange locks its thread the same way, minus the review
    // button (nothing was exchanged, so there is nobody to review). Only the
    // listing owner can cancel after approval, so when the claim carries an
    // approved quantity the canceller is the poster. A request withdrawn
    // before approval also ends as "cancelled"; that one names nobody. The
    // gray box matches how the request pages badge cancelled rows.
    const exchangeIsCancelled = thread.claim_status === 'cancelled'
    let cancelledBanner = null
    if (exchangeIsCancelled) {
      let cancelledTitle = 'This exchange was cancelled.'
      if (thread.approved_quantity !== null && thread.approved_quantity !== undefined) {
        let posterName = 'the poster'
        if (typeof thread.owner_name === 'string' && thread.owner_name !== '') {
          posterName = thread.owner_name
        }
        cancelledTitle = 'This exchange was cancelled by ' + posterName + '.'
      }
      cancelledBanner = (
        <div className="rounded-lg bg-background-alt border border-border px-4 py-3 mb-4">
          <p className="text-sm font-medium text-text">{cancelledTitle}</p>
          <p className="text-sm text-text-muted mt-1">
            The thread is locked, so no new messages can be sent.
          </p>
        </div>
      )
    }

    // Either lock disables the composer; the backend refuses the send too.
    const threadIsLocked = exchangeIsComplete || exchangeIsCancelled

    // The workflow button for the viewer's next step, shown above the
    // composer. While the exchange is approved the requester can confirm the
    // pickup here, the same action My Requests offers; once it is picked up
    // the poster can mark it complete, the same action Incoming Requests
    // offers. Each button renders only for the right party, and the backend
    // checks the caller and the claim status again on the call itself.
    let actionButtonArea = null
    if (
      thread.claim_status === 'approved' &&
      thread.claimant_id !== undefined &&
      thread.claimant_id === memberId
    ) {
      actionButtonArea = (
        <div className="mb-4">
          <button
            type="button"
            disabled={confirmingPickup}
            onClick={() => handleConfirmPickup()}
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-primary-600 border border-primary-200 rounded-md hover:bg-primary-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm the Pickup
          </button>
        </div>
      )
    } else if (
      thread.claim_status === 'picked_up' &&
      thread.owner_id !== undefined &&
      thread.owner_id === memberId
    ) {
      actionButtonArea = (
        <div className="mb-4">
          <button
            type="button"
            disabled={completingExchange}
            onClick={() => handleCompleteExchange()}
            className="inline-flex items-center px-3 py-1 text-xs font-medium text-primary-700 border border-border rounded-md hover:bg-primary-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Mark exchange complete
          </button>
        </div>
      )
    }

    content = (
      <div>
      {listingCard}
      <div className="bg-surface rounded-xl border border-border shadow-sm">
        <div className="p-6">
          {messageList}
        </div>
        <div className="border-t border-border p-6">
          {completedBanner}
          {cancelledBanner}
          {actionButtonArea}
          <form onSubmit={handleSend}>
            <label htmlFor="message-body" className="block text-sm font-semibold text-text mb-2">
              Send a message
            </label>
            <textarea
              id="message-body"
              rows={4}
              maxLength={MESSAGE_MAX_LENGTH}
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              disabled={sending || threadIsLocked}
              placeholder="Type your message here…"
              className="w-full px-4 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-150 resize-y disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <p className="text-xs text-text-muted mt-2">{timeZoneNote}</p>
            {sendError !== '' && (
              <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error mt-3" role="alert">
                {sendError}
              </div>
            )}
            <div className="flex justify-end mt-3">
              <button
                type="submit"
                disabled={sending || threadIsLocked}
                className="px-6 py-2.5 text-sm font-semibold text-text-inverse bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
        </div>
      </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        {/* No back link here on purpose: this page is reached from My
            Requests, Incoming Requests, and direct links, so a single back
            target would often be wrong. The global nav and the browser's own
            back button cover the return trip. */}
        <h1 className="text-3xl font-bold text-text">Exchange Thread</h1>
        <p className="text-sm text-text-muted mt-2">{instructionsText}</p>
      </div>
      {content}
    </div>
  )
}

export default ExchangeThreadPage
