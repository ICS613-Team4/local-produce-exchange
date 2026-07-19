// Talks to the backend notification endpoints (US-22). Copies the service
// shape used across the app: a timeout guard, the X-Member-Id header, and an
// ok/status/data/errorMessage result the pages read without throwing.

export const notificationTimeoutMilliseconds = 3000

export type NotificationsResult = {
  ok: boolean
  status: number
  data: unknown
  errorMessage: string
}

// One notification row. The backend owns this shape, so the page reads a
// successful body with a plain cast to these types. claim_id is the related
// exchange to open (null when a notification has no claim). is_read is shown
// read-only; marking it read is US-23.
export type NotificationItem = {
  id: string
  claim_id: string | null
  kind: string
  message: string
  is_read: boolean
  created_at: string
}

// The whole response: the caller's notifications, newest first, plus how many
// of them are unread. The header bell reads unread_count for its badge.
export type NotificationsResponse = {
  notifications: NotificationItem[]
  unread_count: number
}

// How often the header bell re-asks for the unread count, in milliseconds.
// Fifteen seconds. This is the ONLY place the interval is written; the Layout
// imports it and the tests import it too, so tuning the poll rate is a
// one-line change here and nothing else needs editing.
export const unreadCountPollIntervalMilliseconds = 15000

// The header bell's tiny response: just the count.
export type UnreadCountResponse = {
  unread_count: number
}

// The polled count request. Same shape as the list request below, but it hits
// the count-only endpoint so a poll every 15 seconds never downloads the
// member's notification history.
export async function sendGetUnreadCountRequest(
  memberId: string,
): Promise<NotificationsResult> {
  try {
    const response = await fetch('/api/notifications/unread-count', {
      method: 'GET',
      headers: {
        'X-Member-Id': memberId,
      },
      signal: AbortSignal.timeout(notificationTimeoutMilliseconds),
    })

    const responseText = await response.text()
    let data: unknown = ''
    if (responseText !== '') {
      try {
        data = JSON.parse(responseText)
      } catch {
        data = responseText
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data: data,
      errorMessage: '',
    }
  } catch (caughtError) {
    let errorMessage: string
    if (caughtError instanceof DOMException && caughtError.name === 'TimeoutError') {
      errorMessage =
        'Timeout: no answer from the backend after ' +
        notificationTimeoutMilliseconds +
        ' ms.'
    } else {
      errorMessage = 'Request failed: ' + String(caughtError)
    }

    return {
      ok: false,
      status: 0,
      data: '',
      errorMessage: errorMessage,
    }
  }
}

export async function sendGetNotificationsRequest(
  memberId: string,
): Promise<NotificationsResult> {
  try {
    const response = await fetch('/api/notifications', {
      method: 'GET',
      headers: {
        'X-Member-Id': memberId,
      },
      signal: AbortSignal.timeout(notificationTimeoutMilliseconds),
    })

    const responseText = await response.text()
    let data: unknown = ''
    if (responseText !== '') {
      try {
        data = JSON.parse(responseText)
      } catch {
        data = responseText
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data: data,
      errorMessage: '',
    }
  } catch (caughtError) {
    let errorMessage: string
    if (caughtError instanceof DOMException && caughtError.name === 'TimeoutError') {
      errorMessage =
        'Timeout: no answer from the backend after ' +
        notificationTimeoutMilliseconds +
        ' ms.'
    } else {
      errorMessage = 'Request failed: ' + String(caughtError)
    }

    return {
      ok: false,
      status: 0,
      data: '',
      errorMessage: errorMessage,
    }
  }
}
