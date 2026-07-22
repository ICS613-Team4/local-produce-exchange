// A read-only row of five stars showing one rating (US-21). Both review pages
// use it, so a rating looks the same wherever it is read back. It matches the
// look of the saved-review stars on the leave-a-review page: a filled star is
// amber, an empty one is the site's border grey.
//
// The stars themselves are hidden from screen readers, which read the wrapper's
// label instead, so a rating is announced as one sentence rather than five
// separate star characters.

type StarRatingProps = {
  rating: number
}

function StarRating(props: StarRatingProps) {
  const stars = []
  for (let starNumber = 1; starNumber <= 5; starNumber = starNumber + 1) {
    let starClasses = 'text-lg leading-none text-border'
    if (starNumber <= props.rating) {
      starClasses = 'text-lg leading-none text-amber-500'
    }
    stars.push(
      <span key={starNumber} className={starClasses} aria-hidden="true">
        ★
      </span>,
    )
  }

  return (
    <div
      className="flex items-center gap-0.5"
      aria-label={'Rated ' + props.rating + ' out of 5'}
    >
      {stars}
    </div>
  )
}

export default StarRating
