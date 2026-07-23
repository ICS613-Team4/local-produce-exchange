import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'

import { clearStoredLogin } from '../services/authService'
import { sendGetMemberReviewsRequest } from '../services/reviewService'
import type { MemberReviewsResponse } from '../services/reviewService'
import StarRating from '../components/StarRating'
import { formatTimestamp } from '../utils/formatTimestamp'

// The reviews behind one member's star rating, for ONE of their two roles
// (US-21). Clicking any rating chip in the app lands here, carrying the role
// that chip was showing, like
// /member-reviews?member=<id>&role=listing_owner.
//
// A member has two separate reputations: as a listing owner, and as a
// requestor. They are counted apart in the database and must never be blended
// here, so the role appears in four places at once: the URL, the page heading,
// the subtitle, and the selected tab.
//
// The layout is the one every well-known review page uses: a summary block
// with the average and a bar per star level, then the list of reviews.

function MemberReviewsPage() {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const viewedMemberId = params.get('member') ?? ''
  const role = params.get('role') ?? ''

  const actingMemberId = window.localStorage.getItem('memberId') ?? ''
  const requestInFlightRef = useRef(false)
  const [result, setResult] = useState<{
    ok: boolean
    status: number
    data: unknown
    errorMessage: string
  } | null>(null)

  // Only the two real roles are askable. Anything else is a broken link, so
  // the page says so rather than sending the backend a request it will reject.
  let roleIsKnown = false
  if (role === 'listing_owner' || role === 'requestor') {
    roleIsKnown = true
  }

  useEffect(() => {
    if (viewedMemberId === '') {
      return
    }
    if (role !== 'listing_owner' && role !== 'requestor') {
      return
    }
    if (requestInFlightRef.current) {
      return
    }
    requestInFlightRef.current = true
    // Clear the old list first, so switching tabs shows the loading line
    // instead of the other role's reviews under the new heading.
    setResult(null)

    async function loadReviews() {
      const loaded = await sendGetMemberReviewsRequest(actingMemberId, viewedMemberId, role)
      requestInFlightRef.current = false
      if (loaded.status === 401) {
        clearStoredLogin()
        return
      }
      setResult(loaded)
    }
    loadReviews()
  }, [actingMemberId, viewedMemberId, role])

  // The plain-words version of each role, and of the other one, so the page can
  // point the reader at the reputation they are not looking at.
  let roleWord = 'requestor'
  let otherRoleWord = 'listing owner'
  if (role === 'listing_owner') {
    roleWord = 'listing owner'
    otherRoleWord = 'requestor'
  }

  // A broken or missing role, or no member at all: nothing to look up.
  if (viewedMemberId === '' || !roleIsKnown) {
    return (
      <div className="max-w-3xl mx-auto">
        <h1 className="text-3xl font-bold text-text mb-6">Reviews</h1>
        <div
          className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error"
          role="alert"
        >
          That is not a rating we can show.
        </div>
      </div>
    )
  }

  // The two tabs are plain links, so the browser's back button and a
  // middle-click work the way they do anywhere else on the web.
  const selectedTabClasses =
    'pb-3 text-sm font-semibold text-primary-600 border-b-2 border-primary-600'
  const otherTabClasses =
    'pb-3 text-sm font-semibold text-text-muted border-b-2 border-transparent hover:text-text'

  let listingOwnerTabClasses = otherTabClasses
  let requestorTabClasses = otherTabClasses
  // aria-current tells a screen reader which of the two reputations is on
  // screen, the same fact the underline shows visually.
  let listingOwnerCurrent: 'page' | undefined = undefined
  let requestorCurrent: 'page' | undefined = undefined
  if (role === 'listing_owner') {
    listingOwnerTabClasses = selectedTabClasses
    listingOwnerCurrent = 'page'
  } else {
    requestorTabClasses = selectedTabClasses
    requestorCurrent = 'page'
  }

  const tabBar = (
    <div className="flex gap-6 border-b border-border mb-6">
      <Link
        to={'/member-reviews?member=' + viewedMemberId + '&role=listing_owner'}
        className={listingOwnerTabClasses}
        aria-current={listingOwnerCurrent}
      >
        As a listing owner
      </Link>
      <Link
        to={'/member-reviews?member=' + viewedMemberId + '&role=requestor'}
        className={requestorTabClasses}
        aria-current={requestorCurrent}
      >
        As a requestor
      </Link>
    </div>
  )

  let memberName = ''
  // The summary card stays null while loading and on an error; the list area's
  // chain ends with a plain else, so every path assigns it and it needs no
  // initial value.
  let summaryArea = null
  let listArea

  if (result === null) {
    listArea = <p className="text-text-muted text-sm py-8 text-center">Loading reviews...</p>
  } else if (result.errorMessage !== '') {
    listArea = (
      <div
        className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error"
        role="alert"
      >
        {result.errorMessage}
      </div>
    )
  } else if (result.ok) {
    const loaded = result.data as MemberReviewsResponse
    memberName = loaded.member_name
    const reviews = loaded.reviews

    if (loaded.count === 0 || loaded.average === null) {
      // No zero and no empty bars: an unrated role says so in words, the same
      // rule the rating chip follows.
      summaryArea = (
        <div className="mb-6">
          <p className="text-sm text-text-muted">
            {memberName + ' has no ' + roleWord + ' reviews yet.'}
          </p>
          <p className="text-sm text-text-muted mt-1">
            {'Check their ' + otherRoleWord + ' reviews.'}
          </p>
        </div>
      )
    } else {
      // How the ratings split, one row per star level. Every review is already
      // on this page, so the five counts are worked out here rather than asked
      // for separately.
      const countByStarLevel = [0, 0, 0, 0, 0, 0]
      for (let index = 0; index < reviews.length; index = index + 1) {
        const rating = reviews[index].rating
        countByStarLevel[rating] = countByStarLevel[rating] + 1
      }

      const breakdownRows = []
      for (let starLevel = 5; starLevel >= 1; starLevel = starLevel - 1) {
        const countAtLevel = countByStarLevel[starLevel]
        let percent = 0
        if (loaded.count > 0) {
          percent = (countAtLevel / loaded.count) * 100
        }
        breakdownRows.push(
          <div
            key={starLevel}
            className="flex items-center gap-3"
            aria-label={starLevel + ' stars: ' + countAtLevel + ' reviews'}
          >
            <span className="text-xs text-text-muted w-14">{starLevel + ' stars'}</span>
            <div className="flex-1 h-2 rounded-full bg-background-alt">
              <div
                className="h-2 rounded-full bg-amber-500"
                style={{ width: percent + '%' }}
              />
            </div>
            <span className="text-xs text-text-muted w-6 text-right">{countAtLevel}</span>
          </div>,
        )
      }

      summaryArea = (
        <div className="bg-surface rounded-xl border border-border shadow-sm p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-6">
            <div>
              <p className="text-4xl font-bold text-text">{loaded.average.toFixed(1)}</p>
              <div className="mt-2">
                <StarRating rating={Math.round(loaded.average)} />
              </div>
              <p className="text-sm text-text-muted mt-2">
                {loaded.count + ' review(s) as a ' + roleWord}
              </p>
            </div>
            <div className="flex-1 flex flex-col gap-2">{breakdownRows}</div>
          </div>
        </div>
      )
    }

    const reviewCards = []
    for (let index = 0; index < reviews.length; index = index + 1) {
      const review = reviews[index]

      let initial = '?'
      if (review.reviewer_name !== '') {
        initial = review.reviewer_name.charAt(0)
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
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-primary-50 text-primary-700 flex items-center justify-center text-sm font-semibold">
              {initial}
            </div>
            <div>
              <p className="text-sm font-semibold text-text">{review.reviewer_name}</p>
              <div className="flex items-center gap-3 mt-0.5">
                <StarRating rating={review.rating} />
                <span className="text-xs text-text-muted">
                  {formatTimestamp(review.created_at)}
                </span>
              </div>
            </div>
          </div>
          {bodyLine}
          <p className="text-xs text-text-muted mt-3">
            {'For '}
            <Link
              to={'/listings/' + review.listing_id}
              className="text-xs text-primary-600 hover:text-primary-700"
            >
              {review.listing_title}
            </Link>
          </p>
        </div>,
      )
    }
    listArea = <div>{reviewCards}</div>
  } else {
    // The backend's own sentence, for example "Member not found." on a 404.
    let detail = 'Could not load the reviews. Please try again.'
    if (typeof result.data === 'object' && result.data !== null) {
      const body = result.data as { detail?: unknown }
      if (typeof body.detail === 'string') {
        detail = body.detail
      }
    }
    listArea = (
      <div
        className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error"
        role="alert"
      >
        {detail}
      </div>
    )
  }

  // Until the member's name arrives, the heading still names the role, so the
  // reader can tell which rating they clicked straight away.
  let heading = 'Reviews as a ' + roleWord
  let subtitle = 'These reviews are counted separately from their ' + otherRoleWord + ' reviews.'
  if (memberName !== '') {
    heading = 'Reviews for ' + memberName + ' as a ' + roleWord
    subtitle =
      'This is ' +
      memberName +
      "'s reputation as a " +
      roleWord +
      '. Their ' +
      otherRoleWord +
      ' reviews are counted separately.'
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-text">{heading}</h1>
        <p className="text-sm text-text-muted mt-2">{subtitle}</p>
      </div>
      {tabBar}
      {summaryArea}
      {listArea}
    </div>
  )
}

export default MemberReviewsPage
