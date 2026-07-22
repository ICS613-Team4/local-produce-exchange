import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'

import { clearStoredLogin } from '../services/authService'
import { sendGetReviewsForClaimRequest } from '../services/reviewService'
import type { ReviewsForClaimResponse } from '../services/reviewService'
import StarRating from '../components/StarRating'
import { formatTimestamp } from '../utils/formatTimestamp'

// The reviews left for ONE completed exchange (US-21 / UC-20). Only the two
// people who took part may read them, which the backend enforces; a stranger
// gets a 403 and sees that message here instead of any review text.
//
// The exchange is named in the query string, like /exchange-reviews?claim=<id>,
// the same shape the leave-a-review page uses. RequireAuth guards the route, so
// this page never has to ask whether anyone is logged in.

function ExchangeReviewsPage() {
  const location = useLocation()
  const claimId = new URLSearchParams(location.search).get('claim') ?? ''

  const memberId = window.localStorage.getItem('memberId') ?? ''
  const requestInFlightRef = useRef(false)
  const [result, setResult] = useState<{
    ok: boolean
    status: number
    data: unknown
    errorMessage: string
  } | null>(null)

  useEffect(() => {
    if (claimId === '') {
      return
    }
    if (requestInFlightRef.current) {
      return
    }
    requestInFlightRef.current = true

    async function loadReviews() {
      const loaded = await sendGetReviewsForClaimRequest(memberId, claimId)
      requestInFlightRef.current = false
      if (loaded.status === 401) {
        // The stored id is not a real member. Clearing it makes the shared
        // guard show the log-in message, so this page renders nothing itself.
        clearStoredLogin()
        return
      }
      setResult(loaded)
    }
    loadReviews()
  }, [memberId, claimId])

  let content
  if (claimId === '') {
    content = (
      <div
        className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error"
        role="alert"
      >
        No exchange was chosen. Try opening this page from one of your requests.
      </div>
    )
  } else if (result === null) {
    content = <p className="text-text-muted text-sm py-8 text-center">Loading reviews...</p>
  } else if (result.errorMessage !== '') {
    content = (
      <div
        className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error"
        role="alert"
      >
        {result.errorMessage}
      </div>
    )
  } else if (result.ok) {
    const reviews = (result.data as ReviewsForClaimResponse).reviews
    if (reviews.length === 0) {
      // Scenario 2: the exchange finished but nobody has written anything yet.
      content = (
        <div className="bg-surface rounded-xl border border-border shadow-sm p-6">
          <p className="text-sm text-text-muted" role="status">
            No reviews yet for this exchange.
          </p>
        </div>
      )
    } else {
      const reviewCards = []
      for (let index = 0; index < reviews.length; index = index + 1) {
        const review = reviews[index]

        // Who wrote it and who it is about, phrased for the reader. Only the
        // two participants are ever involved, so one of the first two branches
        // always matches; the third is a safety net.
        let heading
        if (review.by_viewer) {
          heading = 'Your review of ' + review.reviewee_name
        } else if (review.about_viewer) {
          heading = review.reviewer_name + "'s review of you"
        } else {
          heading = review.reviewer_name + "'s review of " + review.reviewee_name
        }

        let bodyLine = null
        if (review.body !== '') {
          bodyLine = (
            <p className="text-sm text-text mt-3 whitespace-pre-wrap break-words">
              {review.body}
            </p>
          )
        }

        reviewCards.push(
          <div
            key={review.id}
            className="bg-surface rounded-xl border border-border shadow-sm p-6 mb-4"
          >
            <p className="text-sm font-semibold text-text">{heading}</p>
            <div className="flex items-center gap-3 mt-2">
              <StarRating rating={review.rating} />
              <span className="text-xs text-text-muted">
                {'rating ' + review.rating + ' out of 5'}
              </span>
            </div>
            {bodyLine}
            <p className="text-xs text-text-muted mt-3">
              {formatTimestamp(review.created_at)}
            </p>
          </div>,
        )
      }
      content = <div>{reviewCards}</div>
    }
  } else {
    // The backend's own sentence for a 403 (not a participant), a 404 (no such
    // exchange), or a 409 (the exchange is not completed yet).
    let detail = 'Could not load the reviews. Please try again.'
    if (typeof result.data === 'object' && result.data !== null) {
      const body = result.data as { detail?: unknown }
      if (typeof body.detail === 'string') {
        detail = body.detail
      }
    }
    content = (
      <div
        className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error"
        role="alert"
      >
        {detail}
      </div>
    )
  }

  // The heading names the listing once the reviews have loaded.
  let pageTitle = 'Reviews for your exchange'
  if (result !== null && result.ok) {
    const loadedTitle = (result.data as ReviewsForClaimResponse).listing_title
    pageTitle = 'Reviews for your exchange: ' + loadedTitle
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-text">{pageTitle}</h1>
        <p className="text-sm text-text-muted mt-2">
          What you and the other member wrote about this completed exchange.
        </p>
      </div>
      {content}
    </div>
  )
}

export default ExchangeReviewsPage
