import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { sendGetNotificationsRequest } from '../services/notificationService'
import type {
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
  // The re-fetch trigger. US-22 never bumps it; US-23 adds the setter and bumps
  // it after a mark-read, so keep this name as is.
  const [reloadCounter] = useState(0)

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
      // order. Every row renders the SAME way: read-versus-unread styling is
      // US-23's job, so no bold, no marker, and no mark-as-read control here.
      const rows = []
      for (const item of notificationItems) {
        // Where the row's action link goes. A new incoming request links to
        // the Incoming Requests page, where the owner acts on it. A withdrawn
        // request gets no link at all: it already left the queue, so there is
        // nothing to open. Every other notification with a claim links to
        // that exchange's thread.
        let actionLink = null
        if (item.kind === 'request_submitted') {
          actionLink = (
            <Link
              to="/requests"
              className="text-xs font-medium text-primary-700 hover:text-primary-600"
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
            >
              Open the exchange
            </Link>
          )
        }
        rows.push(
          <li key={item.id} className="bg-surface rounded-xl border border-border shadow-sm px-4 py-3">
            <p className="text-sm text-text">{item.message}</p>
            <div className="flex items-center gap-4 mt-1">
              <span className="text-xs text-text-muted">{formatTimestamp(item.created_at)}</span>
              {actionLink}
            </div>
          </li>
        )
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
