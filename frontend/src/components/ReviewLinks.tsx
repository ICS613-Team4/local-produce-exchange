// The review controls a completed exchange gets (US-20 and US-21): a link that
// writes or edits the caller's own review of the other party, a link that reads
// both sides' reviews of the exchange, and, once the caller has a review, a
// button that deletes it.
//
// Four places show these controls: My Requests, Incoming Requests, the Exchange
// Thread page, and the dashboard's exchange history. They all point at the
// same two screens and follow the same wording rules, so the controls live
// here once instead of being copied into each page. The delete step itself
// lives in confirmAndDeleteMyReview in the review service, shared with the
// review page, so there is one confirm sentence and one set of rules for the
// whole site.

import { useRef, useState } from 'react'
import { Link } from 'react-router'

import { confirmAndDeleteMyReview } from '../services/reviewService'

// The default look: the outlined accent button the request pages and the
// exchange thread page use. Incoming Requests passes its own slightly
// different variant through linkClasses.
const defaultLinkClasses =
  'inline-flex items-center px-3 py-1.5 text-xs font-medium text-primary-600 border border-primary-200 rounded-md hover:bg-primary-50 transition-colors'

// The destructive variant, the same red outline the deactivate button on My
// Listings uses. The delete button keeps this look even where the page passes
// its own linkClasses, so a removal never looks like an ordinary link.
const deleteButtonClasses =
  'inline-flex items-center px-3 py-1.5 text-xs font-medium text-error border border-red-200 rounded-md hover:bg-error-bg transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

// The other party's first name, for the link label. The full name is split on
// the first space; an empty or missing name falls back to the wording the page
// passes in ("the poster" or "the recipient"), so the label still reads as a
// sentence.
function getFirstName(fullName: string | undefined, fallbackName: string) {
  if (typeof fullName === 'string' && fullName !== '') {
    return fullName.split(' ')[0]
  }
  return fallbackName
}

// The write-a-review link's label. Before the caller has reviewed this
// exchange the link invites a first review; afterwards the same link opens the
// pre-filled edit form, so the label says so.
function getReviewLinkLabel(
  otherPartyFirstName: string,
  reviewedByMe: boolean | undefined,
) {
  if (reviewedByMe === true) {
    return 'Edit Your Review for ' + otherPartyFirstName
  }
  return 'Leave a Review for ' + otherPartyFirstName
}

type ReviewLinksProps = {
  claimId: string
  // The other party's full name, and what to call them when the name is
  // missing ("the poster" for a recipient's row, "the recipient" for a
  // poster's row).
  otherPartyName: string | undefined
  fallbackName: string
  reviewedByMe: boolean | undefined
  linkClasses?: string
  // Called after a review is deleted, so the page can reload its rows and the
  // link label goes back to inviting a first review.
  onDeleted?: () => void
}

function ReviewLinks(props: ReviewLinksProps) {
  let linkClasses = defaultLinkClasses
  if (props.linkClasses !== undefined) {
    linkClasses = props.linkClasses
  }
  const firstName = getFirstName(props.otherPartyName, props.fallbackName)
  const reviewLinkLabel = getReviewLinkLabel(firstName, props.reviewedByMe)

  const memberId = window.localStorage.getItem('memberId') ?? ''
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const deleteInFlightRef = useRef(false)

  async function handleDelete() {
    // Three guards against a double click: the ref blocks a second click in
    // the same tick, the confirm dialog needs a deliberate yes, and the
    // disabled button covers the time the request is in flight. Past all
    // three, a repeat delete is answered as another success by the backend.
    if (deleteInFlightRef.current) {
      return
    }
    deleteInFlightRef.current = true
    setDeleting(true)
    setDeleteError('')

    const outcome = await confirmAndDeleteMyReview(memberId, props.claimId)

    deleteInFlightRef.current = false
    setDeleting(false)

    if (outcome.cancelled) {
      return
    }
    if (outcome.deleted) {
      if (props.onDeleted !== undefined) {
        props.onDeleted()
      }
      return
    }
    setDeleteError(outcome.errorMessage)
  }

  // The delete button appears only once the caller has a review here. With
  // nothing written there is nothing to remove, so the button would be a dead
  // end.
  let deleteButton = null
  if (props.reviewedByMe === true) {
    let deleteLabel = 'Delete My Review'
    if (deleting) {
      deleteLabel = 'Deleting...'
    }
    deleteButton = (
      <button type="button" disabled={deleting} onClick={handleDelete} className={deleteButtonClasses}>
        {deleteLabel}
      </button>
    )
  }

  // A refused delete says why right next to the button that was pressed.
  let deleteErrorLine = null
  if (deleteError !== '') {
    deleteErrorLine = (
      <span className="text-xs text-error" role="alert">
        {deleteError}
      </span>
    )
  }

  return (
    <>
      <Link to={'/review?claim=' + props.claimId} className={linkClasses}>
        {reviewLinkLabel}
      </Link>
      <Link to={'/exchange-reviews?claim=' + props.claimId} className={linkClasses}>
        View Reviews
      </Link>
      {deleteButton}
      {deleteErrorLine}
    </>
  )
}

export default ReviewLinks
