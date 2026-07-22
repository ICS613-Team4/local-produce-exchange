// The one chip that shows a member's average star rating for a single role
// (US-20). Every place a member's reputation appears renders this same chip,
// so the rating reads the same everywhere: a yellow star, the one-decimal
// average, and the role's name in parentheses, sitting inline right after the
// member's name, like "Posted by Bob Baker (star 2.2 listing owner rating)".
// Apart from the yellow star it sets no font size or color of its own, so it
// always matches the sentence it sits in.
//
// A member has TWO separate reputations, one as a listing owner and one as a
// requestor, and this chip shows exactly one of them, named by props.role.
// The chip is presentational only: it renders the numbers passed in and
// computes no average itself.
//
// Clicking the chip opens the reviews behind that average (US-21). The link is
// built from props.role, so every place the chip is rendered sends the role its
// own chip was showing and the two reputations can never be crossed.

import { Link } from 'react-router'

type MemberRatingChipProps = {
  // Whose reputation this is.
  memberId: string
  // Which of the member's two reputations this chip shows.
  role: 'listing_owner' | 'requestor'
  // The role-scoped average, or null when the member has no reviews in this
  // role.
  average: number | null
  // How many reviews are behind the average.
  count: number
}

function MemberRatingChip(props: MemberRatingChipProps) {
  let roleWord = 'requestor'
  if (props.role === 'listing_owner') {
    roleWord = 'listing owner'
  }

  // With no reviews there is no average to show and nothing to click through
  // to, so this branch is plain non-clickable text naming the missing rating,
  // like "(no requestor rating)". It never shows a bare "0" that could read
  // as a bad score.
  if (props.count === 0 || props.average === null) {
    return <span>{'(no ' + roleWord + ' rating)'}</span>
  }

  const averageText = props.average.toFixed(1)

  // A link, not a button with a handler: the back button and a middle-click
  // then work the way they do anywhere else on the web, with no handler to
  // write.
  return (
    <Link
      to={'/member-reviews?member=' + props.memberId + '&role=' + props.role}
      aria-label={"View the reviews behind this member's rating as a " + roleWord}
      className="hover:underline focus:outline-none focus:ring-2 focus:ring-primary-500 rounded"
    >
      {'('}
      <span className="text-amber-500" aria-hidden="true">★</span>
      {' ' + averageText + ' ' + roleWord + ' rating)'}
    </Link>
  )
}

export default MemberRatingChip
