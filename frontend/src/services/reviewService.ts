// API calls for the review feature (US-20). One GET loads everything the
// review screen needs, one POST saves a new review, and one PATCH edits the
// caller's own review. All three hang off the claim id; the backend works out
// who the two participants are, so the same calls serve the poster and the
// recipient.

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
