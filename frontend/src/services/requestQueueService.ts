// API call for the request-queue view (US-10). One GET returns the poster's own
// listing queues; with a listing id it returns just that one listing's queue
// after the backend checks the caller owns it.

import type { ListingPhotoRef } from './listingService'

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
// page reads a successful body with a plain cast to these types. can_decide and
// can_deny are the backend-computed display rules (US-24): can_decide is true when
// approve should be offered, can_deny when deny should be offered. They differ
// because deny needs no remaining quantity, so a fully allocated listing can still
// have a deny button on a pending request.
export type QueueClaimItem = {
  id: string
  claimant_id: string
  claimant_name: string
  requested_quantity: number
  requested_at: string
  can_decide: boolean
  can_deny: boolean
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

// One request in the poster's full per-listing history (US-24). Unlike a pending
// QueueClaimItem, this carries the request's status and its decision timestamps,
// because the all-requests view shows every status. can_decide and can_deny are
// the same display rules: can_decide is true when approve should be offered,
// can_deny when deny should be offered.
export type AllRequestItem = {
  id: string
  claimant_id: string
  claimant_name: string
  requested_quantity: number
  approved_quantity: number | null
  status: string
  requested_at: string
  approved_at: string | null
  picked_up_at: string | null
  completed_at: string | null
  denied_at: string | null
  // Optional so stubbed shapes without the field keep type-checking.
  cancelled_at?: string | null
  can_decide: boolean
  can_deny: boolean
}

// One active listing's full request history: its title and remaining quantity,
// plus every request on it (any status), oldest first. The requests list is
// empty when the listing has no requests yet.
export type ListingAllRequestsGroup = {
  listing_id: string
  listing_title: string
  // "active" or "deactivated"; a deactivated listing still shows while it has
  // requests. Optional so stubbed shapes without the field keep type-checking;
  // a missing value reads as active.
  listing_status?: string
  remaining_quantity: number
  requests: AllRequestItem[]
  // When the listing was posted. Optional so stubbed shapes without the field
  // keep type-checking.
  created_at?: string | null
  // The listing's photos; the first one is the cover. Optional so stubbed
  // shapes without the field keep type-checking.
  photos?: ListingPhotoRef[]
}

// The all-requests response: one group per active listing the caller owns,
// including listings with no requests. An empty list means no active listings.
export type AllRequestsResponse = {
  groups: ListingAllRequestsGroup[]
}

// One of the caller's own requests, for the my-requests page.
export type MyRequestItem = {
  id: string
  listing_id: string
  listing_title: string
  // The listing's own status, "active" or "deactivated". The page links the
  // title only on an active listing, because a deactivated one has no page to
  // show. Optional so stubbed shapes without the field keep type-checking; a
  // missing value reads as active.
  listing_status?: string
  owner_name: string
  requested_quantity: number
  approved_quantity: number | null
  status: string
  requested_at: string
  approved_at: string | null
  picked_up_at: string | null
  completed_at?: string | null
  denied_at: string | null
  cancelled_at?: string | null
  // The requested listing's photos; the first one is the cover. Optional so
  // stubbed shapes without the field keep type-checking.
  photos?: ListingPhotoRef[]
}

// The my-requests response: the caller's requests split into five sections,
// each newest-first. completed and withdrawn are optional so stubbed shapes
// without the fields keep type-checking; the page treats a missing list as
// empty.
export type MyRequestsResponse = {
  pending: MyRequestItem[]
  approved: MyRequestItem[]
  completed?: MyRequestItem[]
  denied: MyRequestItem[]
  withdrawn?: MyRequestItem[]
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

// The body the approve and deny endpoints return (a ClaimResponse). The page
// reads approved_at or denied_at from this with a plain cast on success.
export type ClaimDecisionResponse = {
  id: string
  listing_id: string
  claimant_id: string
  requested_quantity: number
  approved_quantity: number | null
  status: string
  requested_at: string
  approved_at: string | null
  picked_up_at: string | null
  denied_at: string | null
}

export async function sendDecideClaimRequest(
  memberId: string,
  claimId: string,
  decision: string,
): Promise<RequestQueuesResult> {
  // Approve or deny one pending request (US-11). decision is "approve" or
  // "deny", which is also the last path segment. This is a PATCH with no body;
  // the acting member's id travels in the X-Member-Id header like the other
  // calls, and the backend checks the caller owns the listing.
  let url = '/api/claims/' + claimId + '/approve'
  if (decision === 'deny') {
    url = '/api/claims/' + claimId + '/deny'
  }

  try {
    const response = await fetch(url, {
      method: 'PATCH',
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

export async function sendCreateClaimRequest(
  listingId: string,
  memberId: string,
  quantity: number,
): Promise<RequestQueuesResult> {
  // Submit a request (a claim) for some quantity of a listing. POSTs the quantity
  // to /api/listings/<id>/claims; the acting member's id travels in the
  // X-Member-Id header like the other calls. Same result shape as the rest.
  const url = '/api/listings/' + listingId + '/claims'
  const bodyObject = { quantity: quantity }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Member-Id': memberId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyObject),
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

export async function sendGetMyClaimRequest(
  listingId: string,
  memberId: string,
): Promise<RequestQueuesResult> {
  // The viewer's own request on one listing, whatever its status, or null when
  // none. GET /api/listings/<id>/my-claim with the member id in the X-Member-Id
  // header. Same result shape as the rest; data is the claim object or null.
  const url = '/api/listings/' + listingId + '/my-claim'

  try {
    const response = await fetch(url, {
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

export async function sendWithdrawClaimRequest(
  memberId: string,
  claimId: string,
): Promise<RequestQueuesResult> {
  // Withdraw one of the caller's own pending requests (US-12). This is a PATCH
  // with no body to /api/claims/<id>/withdraw; the acting member's id travels in
  // the X-Member-Id header. The backend sets the claim to "cancelled" and checks
  // the caller is the claimant. Same shape as sendDecideClaimRequest, only the
  // URL differs.
  const url = '/api/claims/' + claimId + '/withdraw'

  try {
    const response = await fetch(url, {
      method: 'PATCH',
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

export async function sendConfirmPickupRequest(
  memberId: string,
  claimId: string,
): Promise<RequestQueuesResult> {
  const url = '/api/claims/' + claimId + '/pickup'

  try {
    const response = await fetch(url, {
      method: 'PATCH',
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

export async function sendCancelExchangeRequest(
  memberId: string,
  claimId: string,
): Promise<RequestQueuesResult> {
  // The poster calls off an exchange they already approved (before pickup).
  // PATCH with no body; the backend checks the caller owns the listing, sets
  // the claim to "cancelled", and returns the reserved quantity to the listing.
  const url = '/api/claims/' + claimId + '/cancel'

  try {
    const response = await fetch(url, {
      method: 'PATCH',
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

export async function sendCompleteExchangeRequest(
  memberId: string,
  claimId: string,
): Promise<RequestQueuesResult> {
  const url = '/api/claims/' + claimId + '/complete'

  try {
    const response = await fetch(url, {
      method: 'PATCH',
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

export async function sendGetAllRequestsRequest(
  memberId: string,
  listingId: string,
): Promise<RequestQueuesResult> {
  // The poster's full per-listing request history (US-24): every request on the
  // caller's active listings, all statuses. With no listing id, ask for all of
  // the caller's active listings; with one, append it as ?listing=<id> so the
  // backend returns just that listing's group after the ownership check. The
  // acting member's id travels in the X-Member-Id header. This is a GET, so
  // there is no request body. Same shape as sendGetRequestQueuesRequest, only
  // the path differs.
  let url = '/api/request-queues/all'
  if (listingId !== '') {
    const params = new URLSearchParams()
    params.append('listing', listingId)
    url = '/api/request-queues/all?' + params.toString()
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
