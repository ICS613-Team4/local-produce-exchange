// API call for the request-queue view (US-10). One GET returns the poster's own
// listing queues; with a listing id it returns just that one listing's queue
// after the backend checks the caller owns it.

export const requestQueueTimeoutMilliseconds = 3000

// The result shape every call returns, the same ok / status / data / errorMessage
// shape the listing service uses.
export type RequestQueuesResult = {
  ok: boolean
  status: number
  data: unknown
  errorMessage: string
}

// One pending request in a listing's queue. The backend owns this shape, so the
// page reads a successful body with a plain cast to these types.
export type QueueClaimItem = {
  id: string
  claimant_id: string
  claimant_name: string
  requested_quantity: number
  requested_at: string
}

// One listing's queue: the listing's own details plus its pending rows.
export type ListingQueueGroup = {
  listing_id: string
  listing_title: string
  listing_status: string
  remaining_quantity: number
  pending: QueueClaimItem[]
}

// The whole response body: one group per listing that has pending requests.
export type RequestQueuesResponse = {
  groups: ListingQueueGroup[]
}

export async function sendGetRequestQueuesRequest(
  memberId: string,
  listingId: string,
): Promise<RequestQueuesResult> {
  // With no listing id, ask for all of the caller's queues. With one, append it
  // as ?listing=<id> so the backend returns just that listing's queue after the
  // ownership check. The acting member's id travels in the X-Member-Id header,
  // the same identity path the listing calls use. This is a GET, so there is no
  // request body.
  let url = '/api/request-queues'
  if (listingId !== '') {
    const params = new URLSearchParams()
    params.append('listing', listingId)
    url = '/api/request-queues?' + params.toString()
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Member-Id': memberId,
      },
      // Cancel the request if the backend takes too long to answer.
      signal: AbortSignal.timeout(requestQueueTimeoutMilliseconds),
    })

    const responseText = await response.text()
    let data: unknown = ''
    if (responseText !== '') {
      try {
        data = JSON.parse(responseText)
      } catch {
        // If a proxy or server problem returns plain text or HTML, keep the
        // HTTP status and show the body instead of throwing it away.
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
    // Without this catch, a timeout or network failure would print
    // "Uncaught (in promise)" in the console instead of showing on the page.
    let errorMessage: string
    if (caughtError instanceof DOMException && caughtError.name === 'TimeoutError') {
      errorMessage =
        'Timeout: no answer from the backend after ' + requestQueueTimeoutMilliseconds + ' ms.'
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

export async function sendGetMyRequestsRequest(memberId: string): Promise<RequestQueuesResult> {
  // The outgoing view: the caller's own pending requests on other members'
  // listings. Same result shape and X-Member-Id header as the incoming queue
  // call, but a different URL and no listing filter. This is a GET, so there is
  // no request body.
  try {
    const response = await fetch('/api/my-requests', {
      method: 'GET',
      headers: {
        'X-Member-Id': memberId,
      },
      signal: AbortSignal.timeout(requestQueueTimeoutMilliseconds),
    })

    const responseText = await response.text()
    let data: unknown = ''
    if (responseText !== '') {
      try {
        data = JSON.parse(responseText)
      } catch {
        // If a proxy or server problem returns plain text or HTML, keep the
        // HTTP status and show the body instead of throwing it away.
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
        'Timeout: no answer from the backend after ' + requestQueueTimeoutMilliseconds + ' ms.'
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
