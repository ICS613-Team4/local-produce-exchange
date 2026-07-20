import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'

import {
  sendCreateReviewRequest,
  sendEditReviewRequest,
  sendGetReviewContextRequest,
} from '../services/reviewService'
import type { ReviewContext } from '../services/reviewService'
import { authStateChangedEventName } from '../services/authService'
import { formatTimestamp } from '../utils/formatTimestamp'

const notLoggedInMessage = 'You need to be logged in to leave a review.'
const REVIEW_BODY_MAX_LENGTH = 1000

// The one sentence shown when an administrator disabled the caller's review.
// It matches the backend's sentence word for word, so the member reads the
// same message on the screen and in a refused submit.
const disabledReviewMessage =
  'An administrator disabled your review for this exchange because it broke ' +
  'the community rules. You cannot edit it or leave a new review for this exchange.'

// The word shown next to the chosen star count, the way Amazon and Google
// Maps label their star rows.
function getRatingWord(rating: number) {
  if (rating === 1) {
    return 'Poor'
  }
  if (rating === 2) {
    return 'Fair'
  }
  if (rating === 3) {
    return 'Good'
  }
  if (rating === 4) {
    return 'Very good'
  }
  if (rating === 5) {
    return 'Excellent'
  }
  return ''
}

// A read-only star row for the frozen panel: filled to the saved rating,
// using the same two token colors as the input stars.
function buildReadOnlyStars(rating: number) {
  const stars = []
  for (let starNumber = 1; starNumber <= 5; starNumber = starNumber + 1) {
    let starClasses = 'text-2xl leading-none text-border'
    if (starNumber <= rating) {
      starClasses = 'text-2xl leading-none text-amber-500'
    }
    stars.push(
      <span key={starNumber} className={starClasses} aria-hidden="true">
        ★
      </span>,
    )
  }
  return (
    <div className="flex items-center gap-1" aria-label={'Rated ' + rating + ' out of 5'}>
      {stars}
      <span className="ml-3 text-sm text-text-muted">{getRatingWord(rating)}</span>
    </div>
  )
}

type ReviewFormProps = {
  isEdit: boolean
  initialRating: number
  initialBody: string
  lastUpdatedAt: string
  submitting: boolean
  submitError: string
  onSubmit: (rating: number, body: string) => void
}

// The one form both sides and both modes use (create and edit), so they can
// never drift apart. Only the initial values, the heading, the button label,
// and which service call runs on submit differ, and the parent decides those.
function ReviewForm(props: ReviewFormProps) {
  const [rating, setRating] = useState(props.initialRating)
  const [hoverRating, setHoverRating] = useState(0)
  const [body, setBody] = useState(props.initialBody)

  // The star row: five buttons that fill left-to-right on hover and lock on
  // click, the interaction users already know from Amazon and Google Maps.
  let displayRating = rating
  if (hoverRating !== 0) {
    displayRating = hoverRating
  }
  const starButtons = []
  for (let starNumber = 1; starNumber <= 5; starNumber = starNumber + 1) {
    let starColorClass = 'text-border'
    if (starNumber <= displayRating) {
      starColorClass = 'text-amber-500'
    }
    const thisStarNumber = starNumber
    starButtons.push(
      <button
        key={starNumber}
        type="button"
        role="radio"
        aria-checked={starNumber === rating}
        aria-label={'Rate ' + starNumber + ' out of 5'}
        onMouseEnter={() => setHoverRating(thisStarNumber)}
        onMouseLeave={() => setHoverRating(0)}
        onClick={() => setRating(thisStarNumber)}
        className={
          'text-2xl leading-none focus:outline-none focus:ring-2 focus:ring-primary-500 rounded transition-colors duration-150 ' +
          starColorClass
        }
      >
        ★
      </button>,
    )
  }

  let submitLabel = 'Submit Review'
  let expectationLine =
    'You can edit this review later, but an administrator may disable it if it breaks the rules.'
  if (props.isEdit) {
    submitLabel = 'Save Changes'
    expectationLine = 'Saving replaces your current rating and text.'
  }

  // On the create form the rating starts at 0 (nothing chosen), and submit
  // stays disabled until a star is picked. The server still enforces 1 to 5.
  let submitDisabled = false
  if (props.submitting) {
    submitDisabled = true
  }
  if (rating === 0) {
    submitDisabled = true
  }

  let lastUpdatedLine = null
  if (props.isEdit && props.lastUpdatedAt !== '') {
    lastUpdatedLine = (
      <p className="text-xs text-text-muted mt-2">
        Last updated {formatTimestamp(props.lastUpdatedAt)}
      </p>
    )
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    props.onSubmit(rating, body)
  }

  return (
    <div className="bg-surface rounded-xl border border-border shadow-sm">
      <form onSubmit={handleSubmit}>
        <div className="p-6">
          <span className="block text-sm font-semibold text-text mb-2">Your rating</span>
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating">
            {starButtons}
            <span className="ml-3 text-sm text-text-muted">{getRatingWord(displayRating)}</span>
          </div>
          {lastUpdatedLine}
        </div>
        <div className="border-t border-border p-6">
          <label htmlFor="review-body" className="block text-sm font-semibold text-text mb-2">
            Your review (optional)
          </label>
          <textarea
            id="review-body"
            rows={4}
            maxLength={REVIEW_BODY_MAX_LENGTH}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={props.submitting}
            placeholder="How did the exchange go?"
            className="w-full px-4 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-150 resize-y disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <p className="text-xs text-text-muted mt-2">
            Up to {REVIEW_BODY_MAX_LENGTH} characters. Leaving it blank is fine.
          </p>
          {props.submitError !== '' && (
            <div
              className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error mt-3"
              role="alert"
            >
              {props.submitError}
            </div>
          )}
          <div className="flex justify-end mt-3">
            <button
              type="submit"
              disabled={submitDisabled}
              className="px-6 py-2.5 text-sm font-semibold text-text-inverse bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitLabel}
            </button>
          </div>
          <p className="text-xs text-text-muted mt-3 text-right">{expectationLine}</p>
        </div>
      </form>
    </div>
  )
}

function LeaveReviewPage() {
  const location = useLocation()
  const claimId = new URLSearchParams(location.search).get('claim') ?? ''

  const latestRequestNumber = useRef(0)
  const [memberId] = useState(window.localStorage.getItem('memberId') ?? '')
  const [context, setContext] = useState<ReviewContext | null>(null)
  const [loadError, setLoadError] = useState('')
  const [reloadCounter, setReloadCounter] = useState(0)

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [lastAction, setLastAction] = useState('')
  const submitInFlightRef = useRef(false)

  // Load the review context whenever the page mounts or a review is saved.
  useEffect(() => {
    latestRequestNumber.current = latestRequestNumber.current + 1
    if (memberId === '' || claimId === '') {
      return
    }
    const requestNumber = latestRequestNumber.current
    async function loadContext() {
      const result = await sendGetReviewContextRequest(memberId, claimId)
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
        setContext(result.data as ReviewContext)
        setLoadError('')
      } else {
        // The 403, 404, and 409 messages from the GET land here, so a
        // non-participant, a missing exchange, and a not-yet-completed
        // exchange each show the server's own sentence.
        let detail = 'Could not load this review page. Please try again.'
        if (typeof result.data === 'object' && result.data !== null) {
          const d = result.data as { detail?: unknown }
          if (typeof d.detail === 'string') detail = d.detail
        }
        setLoadError(detail)
      }
    }
    loadContext()
  }, [memberId, claimId, reloadCounter])

  async function handleSubmitReview(rating: number, body: string) {
    // The in-flight guard plus the disabled button stop a double click from
    // sending two requests.
    if (submitInFlightRef.current) {
      return
    }
    submitInFlightRef.current = true
    setSubmitting(true)
    setSubmitError('')

    const isEdit = context !== null && context.can_edit
    let result
    if (isEdit) {
      result = await sendEditReviewRequest(memberId, claimId, rating, body)
    } else {
      result = await sendCreateReviewRequest(memberId, claimId, rating, body)
    }

    submitInFlightRef.current = false
    setSubmitting(false)

    if (result.errorMessage !== '') {
      setSubmitError(result.errorMessage)
      return
    }
    if (result.ok) {
      if (isEdit) {
        setLastAction('edit')
      } else {
        setLastAction('create')
      }
      setSubmitted(true)
      // Reload the context so a follow-up visit reflects the new values.
      setReloadCounter((c) => c + 1)
    } else {
      // The server's own messages surface here if state changed under the
      // member: the duplicate 409 from a second tab, or the "disabled by an
      // administrator" 403 if an admin acted while the form was open.
      let detail = 'Could not save your review. Please try again.'
      if (typeof result.data === 'object' && result.data !== null) {
        const d = result.data as { detail?: unknown }
        if (typeof d.detail === 'string') detail = d.detail
      }
      setSubmitError(detail)
    }
  }

  // The subtitle names the other party once the context is loaded.
  let subtitleText = 'Tell other members how this exchange went.'
  if (context !== null) {
    subtitleText = 'Tell other members how the exchange with ' + context.other_party_name + ' went.'
  }

  // The page serves four states, so the title says which one the member is
  // in: writing a first review, editing their existing one, looking at a
  // review an administrator froze, or confirming a save.
  let pageTitle = 'Leave a Review'
  if (submitted) {
    pageTitle = 'Review Saved'
  } else if (context !== null && context.already_reviewed && context.existing_review !== null) {
    if (context.existing_review.is_disabled) {
      pageTitle = 'Your Review'
    } else {
      pageTitle = 'Edit Your Review'
    }
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
  } else if (context === null) {
    content = <p className="text-text-muted text-sm py-8 text-center">Loading...</p>
  } else if (submitted) {
    let successMessage = 'Thanks. Your review has been saved.'
    if (lastAction === 'edit') {
      successMessage = 'Your review has been updated.'
    }
    content = (
      <div className="bg-surface rounded-xl border border-border p-6 shadow-sm">
        <p role="status" className="text-sm text-text">
          {successMessage}
        </p>
        <p className="mt-3">
          <Link
            to="/dashboard"
            className="text-sm font-semibold text-primary-600 hover:text-primary-700"
          >
            Back to your dashboard
          </Link>
        </p>
      </div>
    )
  } else if (
    context.already_reviewed &&
    context.existing_review !== null &&
    context.existing_review.is_disabled
  ) {
    // The frozen panel (Rule 3): the member's saved stars and text, read-only,
    // with the plain sentence explaining an administrator disabled it. No
    // form, no star buttons, no submit button.
    content = (
      <div className="bg-surface rounded-xl border border-border p-6 shadow-sm">
        {buildReadOnlyStars(context.existing_review.rating)}
        {context.existing_review.body !== '' && (
          <p className="text-sm text-text mt-3 whitespace-pre-wrap break-words">
            {context.existing_review.body}
          </p>
        )}
        <div
          className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error mt-4"
          role="alert"
        >
          {disabledReviewMessage}
        </div>
      </div>
    )
  } else if (context.already_reviewed && context.can_edit && context.existing_review !== null) {
    // The edit form (Rule 2), pre-filled from the saved review.
    content = (
      <ReviewForm
        isEdit={true}
        initialRating={context.existing_review.rating}
        initialBody={context.existing_review.body}
        lastUpdatedAt={context.existing_review.updated_at}
        submitting={submitting}
        submitError={submitError}
        onSubmit={handleSubmitReview}
      />
    )
  } else {
    // No review yet: the empty create form.
    content = (
      <ReviewForm
        isEdit={false}
        initialRating={0}
        initialBody=""
        lastUpdatedAt=""
        submitting={submitting}
        submitError={submitError}
        onSubmit={handleSubmitReview}
      />
    )
  }

  // The listing summary card, shown once the context is loaded and the page
  // is not in an error state.
  let summaryCard = null
  if (memberId !== '' && claimId !== '' && loadError === '' && context !== null) {
    let roleSentence = 'You received this produce.'
    if (context.role === 'listing_owner') {
      roleSentence = 'You posted this listing.'
    }
    summaryCard = (
      <div className="bg-surface rounded-xl border border-border p-6 shadow-sm mb-6">
        <h2 className="text-base font-semibold text-text">{context.listing_title}</h2>
        <p className="text-xs text-text-muted mt-0.5">{roleSentence}</p>
        <p className="text-xs text-text-muted mt-0.5">
          Completed {formatTimestamp(context.completed_at)}
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-text">{pageTitle}</h1>
        <p className="text-sm text-text-muted mt-2">{subtitleText}</p>
      </div>
      {summaryCard}
      {content}
    </div>
  )
}

export default LeaveReviewPage
