import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import {
  notificationsChangedEventName,
  sendGetNotificationsRequest,
  sendMarkNotificationReadRequest,
} from '../services/notificationService'
import type {
  NotificationItem,
  NotificationsResponse,
  NotificationsResult,
} from '../services/notificationService'
import { authStateChangedEventName } from '../services/authService'
import { formatTimestamp, getLocalTimeZoneNote } from '../utils/formatTimestamp'

const notLoggedInMessage = 'You need to be logged in to see this page.'

function NotificationsPage() {
  const latestRequestNumber = useRef(0)
  const [memberId, setMemberId] = useState(window.localStorage.getItem('memberId') ?? '')
  const [result, setResult] = useState<NotificationsResult | null>(null)
  // Bumped after a successful mark-read to re-run the load effect, so the row
  // flips to read without a full page reload.
  const [reloadCounter, setReloadCounter] = useState(0)

  // The notification id whose mark-read is in flight, so only that row's button
  // is disabled while it runs.
  const [markingId, setMarkingId] = useState('')

  // Same-tick double-click guard, holding the notification id in flight.
  const markInFlightRef = useRef('')

  // Load the caller's notifications when the page has a logged-in member, and
  // again whenever reloadCounter changes.
  useEffect(() => {
    latestRequestNumber.current = latestRequestNumber.current + 1
    if (memberId === '') { return }
    const requestNumber = latestRequestNumber.current
    async function loadNotifications() {
      const loadedResult = await sendGetNotificationsRequest(memberId)
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
    loadNotifications()
  }, [memberId, reloadCounter])

  // Mark one notification read (US-23). Same guard-and-reload shape as the
  // withdraw handler on MyRequestsPage: a same-tick double-click guard, the
  // call, then on success a reloadCounter bump so the row re-renders as read.
  // showFailureAlert is false on the link-click path, where the member asked to
  // navigate rather than to mark, so a failure stays silent there.
  async function handleMarkRead(notificationId: string, showFailureAlert = true) {
    if (markInFlightRef.current === notificationId) {
      return
    }
    markInFlightRef.current = notificationId
    setMarkingId(notificationId)

    const markResult = await sendMarkNotificationReadRequest(memberId, notificationId)

    if (markInFlightRef.current === notificationId) {
      markInFlightRef.current = ''
    }
    setMarkingId('')

    if (markResult.errorMessage !== '') {
      if (showFailureAlert === true) {
        window.alert(markResult.errorMessage)
      }
      return
    }

    // A stale session (the stored member id no longer resolves) is handled the
    // same way the load effect above handles it: clear the stored login and
    // tell the rest of the app, rather than showing a raw "not authenticated"
    // detail in an alert.
    if (markResult.status === 401) {
      window.localStorage.removeItem('memberId')
      window.localStorage.removeItem('memberName')
      window.localStorage.removeItem('memberEmail')
      setMemberId('')
      window.dispatchEvent(new Event(authStateChangedEventName))
      return
    }

    if (markResult.ok === false) {
      let detailMessage = 'Could not mark the notification read. Please try again.'
      if (typeof markResult.data === 'object' && markResult.data !== null) {
        const dataObject = markResult.data as { detail?: unknown }
        if (typeof dataObject.detail === 'string') {
          detailMessage = dataObject.detail
        }
      }
      if (showFailureAlert === true) {
        window.alert(detailMessage)
      }
      return
    }

    setReloadCounter((currentValue) => currentValue + 1)

    // One notification just became read, so the header's unread badge is now
    // one too high. Tell the header to re-read the count instead of letting it
    // sit stale until its next scheduled refresh. The header owns the count, so
    // no number is passed here; this only says "the count changed, go look".
    window.dispatchEvent(new Event(notificationsChangedEventName))
  }

  // Clicking the action link on an UNREAD row marks it read too, because
  // opening what a notification points at is reading it. Deliberately NOT
  // awaited: the navigation must happen right now, so the mark is fired and the
  // click falls through to the Link. A slow or failed mark cannot delay or
  // cancel the navigation. handleMarkRead already ignores a repeat call for a
  // notification whose mark is in flight, and the backend is idempotent, so a
  // double click is harmless.
  function handleLinkClick(item: NotificationItem) {
    if (item.is_read === false) {
      handleMarkRead(item.id, false)
    }
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
    contentArea = <p className="text-text-muted text-sm py-8 text-center">Loading your notifications...</p>
  } else if (result.errorMessage !== '') {
    contentArea = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
        {result.errorMessage}
      </div>
    )
  } else if (result.ok) {
    const responseData = result.data as NotificationsResponse
    let notificationItems = responseData.notifications
    if (notificationItems === undefined) {
      notificationItems = []
    }
    if (notificationItems.length === 0) {
      contentArea = (
        <p className="text-sm text-text-muted py-3">
          You have no notifications yet. When an exchange you are part of
          changes status, a note about it shows up here.
        </p>
      )
    } else {
      // The backend already returns the rows newest first, so render them in
      // order. An unread row shows its message in bold with an "[Unread]"
      // label and a "Mark as read" button; a read row shows normal weight with
      // a "[Read]" label and no button (US-23's visual distinction).
      const rows = []
      for (const item of notificationItems) {
        // Where the row's action link goes. A new incoming request links to
        // the Incoming Requests page, where the owner acts on it. A withdrawn
        // request gets no link at all: it already left the queue, so there is
        // nothing to open. Every other notification with a claim links to
        // that exchange's thread. Clicking whichever link comes out of this
        // also marks an unread row read on the way out (handleLinkClick).
        let actionLink = null
        if (item.kind === 'request_submitted') {
          actionLink = (
            <Link
              to="/requests"
              className="text-xs font-medium text-primary-700 hover:text-primary-600"
              onClick={() => handleLinkClick(item)}
            >
              Open your incoming requests
            </Link>
          )
        } else if (item.kind === 'request_withdrawn') {
          actionLink = null
        } else if (item.claim_id !== null) {
          const exchangeThreadTarget = '/exchange-thread?claim=' + item.claim_id
          actionLink = (
            <Link
              to={exchangeThreadTarget}
              className="text-xs font-medium text-primary-700 hover:text-primary-600"
              onClick={() => handleLinkClick(item)}
            >
              Open the exchange
            </Link>
          )
        }

        if (item.is_read === false) {
          const isThisRowMarking = markingId === item.id
          rows.push(
            <li key={item.id} className="bg-surface rounded-xl border border-border shadow-sm px-4 py-3">
              <p className="text-sm font-bold text-text">{item.message}</p>
              <div className="flex items-center gap-4 mt-1">
                <span className="text-xs text-text-muted">[Unread]</span>
                <span className="text-xs text-text-muted">{formatTimestamp(item.created_at)}</span>
                <button
                  type="button"
                  disabled={isThisRowMarking}
                  onClick={() => handleMarkRead(item.id)}
                  className="text-xs font-medium text-primary-700 hover:text-primary-600"
                >
                  Mark as read
                </button>
                {actionLink}
              </div>
            </li>
          )
        } else {
          rows.push(
            <li key={item.id} className="bg-surface rounded-xl border border-border shadow-sm px-4 py-3">
              <p className="text-sm text-text">{item.message}</p>
              <div className="flex items-center gap-4 mt-1">
                <span className="text-xs text-text-muted">[Read]</span>
                <span className="text-xs text-text-muted">{formatTimestamp(item.created_at)}</span>
                {actionLink}
              </div>
            </li>
          )
        }
      }
      contentArea = (
        <>
          <p className="text-xs text-text-muted mb-4">{timeZoneNote}</p>
          <ul className="space-y-3">{rows}</ul>
        </>
      )
    }
  } else {
    let detailMessage = 'Could not load your notifications. Please try again.'
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
      <h1 className="text-3xl font-bold text-text mb-6">Notifications</h1>
      {contentArea}
    </section>
  )
}

export default NotificationsPage
