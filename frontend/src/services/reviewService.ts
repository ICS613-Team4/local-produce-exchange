// API calls for the review feature. One GET loads everything the
// review screen needs, one POST saves a new review, one PATCH edits the
// caller's own review, and one DELETE removes it (US-20). All four hang off
// the claim id; the backend works out who the two participants are, so the
// same calls serve the poster and the recipient.
//
// Two more GETs read reviews back (US-21): one for a single completed
// exchange, and one for a member's reviews in one of their two roles.

export const reviewTimeoutMilliseconds = 3000

// The result shape every call returns, the same ok / status / data /
// errorMessage shape the other services use.
export type ReviewResult = {
  ok: boolean
  status: number
  data: unknown
  errorMessage: string
}

// One saved review. The backend owns this shape, so the page reads a
// successful body with a plain cast to these types. is_disabled is true when
// an administrator disabled the review; the raw audit columns are not sent.
export type ReviewResponse = {
  id: string
  claim_id: string
  reviewer_id: string
  reviewee_id: string
  reviewee_role: string
  rating: number
  body: string
  created_at: string
  updated_at: string
  is_disabled: boolean
}

// Everything the review screen needs to render, for either side. role is the
// CALLER's role on this exchange ("listing_owner" or "requestor"); the other
// party's role is always the other one. can_edit is true only when the caller
// has a review here and it is not disabled.
export type ReviewContext = {
  claim_id: string
  listing_id: string
  listing_title: string
  role: string
  other_party_id: string
  other_party_name: string
  completed_at: string
  already_reviewed: boolean
  existing_review: ReviewResponse | null
  can_edit: boolean
}

// One review on a completed exchange, as the per-exchange page reads it.
// about_viewer is true when the review is ABOUT the member looking at the
// page; by_viewer is true when that member WROTE it. Only the two
// participants are involved, so every review is one or the other.
export type ReviewForClaimItem = {
  id: string
  reviewer_id: string
  reviewer_name: string
  reviewee_id: string
  reviewee_name: string
  reviewee_role: string
  rating: number
  body: string
  created_at: string
  updated_at: string
  about_viewer: boolean
  by_viewer: boolean
}

export type ReviewsForClaimResponse = {
  claim_id: string
  listing_title: string
  reviews: ReviewForClaimItem[]
}

// One review behind a member's star rating. It names the reviewer and the
// listing the exchange was for, and nothing about the other party's private
// state.
export type MemberReviewItem = {
  id: string
  reviewer_name: string
  listing_id: string
  listing_title: string
  rating: number
  body: string
  created_at: string
}

// A member's reputation in ONE role. average is null when the member has no
// reviews in that role, which the page shows as a message rather than a zero.
export type MemberReviewsResponse = {
  member_id: string
  member_name: string
  role: string
  average: number | null
  count: number
  reviews: MemberReviewItem[]
}

export async function sendGetReviewContextRequest(
  memberId: string,
  claimId: string,
): Promise<ReviewResult> {
  const url = '/api/claims/' + claimId + '/review'

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Member-Id': memberId,
      },
      signal: AbortSignal.timeout(reviewTimeoutMilliseconds),
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
        'Timeout: no answer from the backend after ' + reviewTimeoutMilliseconds + ' ms.'
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

export async function sendGetReviewsForClaimRequest(
  memberId: string,
  claimId: string,
): Promise<ReviewResult> {
  // Every review on one completed exchange. The backend allows only the two
  // participants, so a stranger gets a 403 here.
  const url = '/api/claims/' + claimId + '/reviews'

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Member-Id': memberId,
      },
      signal: AbortSignal.timeout(reviewTimeoutMilliseconds),
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
        'Timeout: no answer from the backend after ' + reviewTimeoutMilliseconds + ' ms.'
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

export async function sendGetMemberReviewsRequest(
  actingMemberId: string,
  memberId: string,
  role: string,
): Promise<ReviewResult> {
  // Two different member ids are in play: actingMemberId is whoever is logged
  // in and travels in the header, and memberId is whose reviews are being
  // read and goes in the path. Keeping them named apart is what stops the
  // page from reading the wrong member's reputation.
  const params = new URLSearchParams()
  params.append('role', role)
  const url = '/api/members/' + memberId + '/reviews?' + params.toString()

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Member-Id': actingMemberId,
      },
      signal: AbortSignal.timeout(reviewTimeoutMilliseconds),
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
        'Timeout: no answer from the backend after ' + reviewTimeoutMilliseconds + ' ms.'
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

export async function sendCreateReviewRequest(
  memberId: string,
  claimId: string,
  rating: number,
  body: string,
): Promise<ReviewResult> {
  const url = '/api/claims/' + claimId + '/reviews'

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Member-Id': memberId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: rating, body: body }),
      signal: AbortSignal.timeout(reviewTimeoutMilliseconds),
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
        'Timeout: no answer from the backend after ' + reviewTimeoutMilliseconds + ' ms.'
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

export async function sendDeleteReviewRequest(
  memberId: string,
  claimId: string,
): Promise<ReviewResult> {
  // The delete path (Rule 4). Like the edit URL, this one carries no review
  // id, so the backend can only ever reach the caller's own review for this
  // claim. A success comes back as a 204 with an empty body, and deleting a
  // review that is already gone is a 204 as well.
  const url = '/api/claims/' + claimId + '/review'

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'X-Member-Id': memberId,
      },
      signal: AbortSignal.timeout(reviewTimeoutMilliseconds),
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
        'Timeout: no answer from the backend after ' + reviewTimeoutMilliseconds + ' ms.'
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

// What the member is asked before a review is removed. One sentence, in one
// place, so the question reads the same wherever the delete button is.
export const deleteReviewConfirmMessage =
  'Delete your review? It is removed from this exchange and from the other ' +
  "member's rating. You can write a new one later."

export type DeleteReviewOutcome = {
  // True when the member said no at the confirm dialog and nothing was sent.
  cancelled: boolean
  // True when the server reports the review is gone. Deleting a review that
  // was already deleted counts as deleted, so a double click ends here too.
  deleted: boolean
  errorMessage: string
}

// The whole delete step: ask, send, and work out what to tell the member. The
// delete button on the request pages, the exchange thread, the dashboard, and
// the review page all call this, so the question and the refusal wording
// cannot drift apart. It is the one function in this file that touches the
// screen, through the browser's own confirm dialog.
export async function confirmAndDeleteMyReview(
  memberId: string,
  claimId: string,
): Promise<DeleteReviewOutcome> {
  // Ask first. A removed review cannot be brought back, so the member says yes
  // on purpose before anything is sent.
  const confirmed = window.confirm(deleteReviewConfirmMessage)
  if (confirmed === false) {
    return { cancelled: true, deleted: false, errorMessage: '' }
  }

  const result = await sendDeleteReviewRequest(memberId, claimId)

  if (result.errorMessage !== '') {
    return { cancelled: false, deleted: false, errorMessage: result.errorMessage }
  }
  if (result.ok) {
    return { cancelled: false, deleted: true, errorMessage: '' }
  }

  // The server's own sentence when it refuses, such as a review an
  // administrator disabled while the page was open.
  let detail = 'Could not delete your review. Please try again.'
  if (typeof result.data === 'object' && result.data !== null) {
    const body = result.data as { detail?: unknown }
    if (typeof body.detail === 'string') {
      detail = body.detail
    }
  }
  return { cancelled: false, deleted: false, errorMessage: detail }
}

export async function sendEditReviewRequest(
  memberId: string,
  claimId: string,
  rating: number,
  body: string,
): Promise<ReviewResult> {
  // The edit path (Rule 2). The URL carries no review id: the backend can
  // only ever reach the caller's own review for this claim.
  const url = '/api/claims/' + claimId + '/review'

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'X-Member-Id': memberId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rating: rating, body: body }),
      signal: AbortSignal.timeout(reviewTimeoutMilliseconds),
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
        'Timeout: no answer from the backend after ' + reviewTimeoutMilliseconds + ' ms.'
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
