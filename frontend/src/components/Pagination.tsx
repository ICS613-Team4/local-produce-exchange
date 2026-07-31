// The site's one pagination control (US-33). Every paged list renders this same
// component, so paging looks and behaves the same on Browse, My Listings, My
// Requests, and Incoming Requests: a count line, Prev, the page numbers, Next.
//
// It is presentational and stateless. It is told which page it is on and how
// many rows exist in total, and it reports a click back through onPageChange;
// the page that renders it owns the URL, which is where the current page
// actually lives. That split is what lets one control serve a flat list, one
// section of a stacked page, and a grouped list without knowing the difference.
//
// It renders nothing at all when everything fits on one page, so a short list
// and an empty list both stay exactly as they were before paging existed
// (Scenarios 4 and 5).

import { buildPageList, countPages, describeShownRange } from '../utils/pagination'

type PaginationProps = {
  // The page being shown, 1-based.
  page: number
  // How many rows one page holds.
  pageSize: number
  // How many rows exist across every page.
  total: number
  // Called with the page the member asked for. The parent puts it in the URL.
  onPageChange: (nextPage: number) => void
  // Names this control for a screen reader, so a page with several of them (My
  // Requests has one per section) says which list each one pages. Read as
  // "<label> pagination", for example "Pending requests pagination".
  label: string
}

// One shared look for every clickable control here, so Prev, Next, and the page
// numbers are the same size and line up on one row.
const controlClasses =
  'inline-flex items-center justify-center min-w-9 h-9 px-3 text-sm font-medium rounded-md border transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500'
const idleClasses = controlClasses + ' text-text-muted border-border hover:bg-background-alt hover:text-text'
// The current page is filled in, so it reads as the page you are on rather than
// as one more button to press.
const currentClasses = controlClasses + ' text-text-inverse bg-primary-600 border-primary-600'
// A control at the end of the list is disabled rather than hidden, so the row
// does not change width when the member reaches the first or last page.
const disabledClasses = controlClasses + ' text-text-muted border-border opacity-50 cursor-not-allowed'

function Pagination(props: PaginationProps) {
  const totalPages = countPages(props.total, props.pageSize)

  // Nothing to page through. This covers both a list that fits on one page and
  // a list with no rows at all, so the page's own empty state is the only thing
  // the member sees.
  if (totalPages <= 1) {
    return null
  }

  const isFirstPage = props.page <= 1
  const isLastPage = props.page >= totalPages

  function handlePrevious() {
    props.onPageChange(props.page - 1)
  }

  function handleNext() {
    props.onPageChange(props.page + 1)
  }

  // The numbered buttons, with a gap wherever a run of pages is left out. The
  // gap is aria-hidden: it is a visual placeholder, and a screen reader
  // announcing "ellipsis" between two page numbers only adds noise.
  const pageEntries = buildPageList(props.page, totalPages)
  const pageButtons = []
  for (let index = 0; index < pageEntries.length; index = index + 1) {
    const entry = pageEntries[index]
    if (entry === 'gap') {
      pageButtons.push(
        <li key={'gap-' + index} aria-hidden="true" className="px-1 text-sm text-text-muted">
          …
        </li>,
      )
      continue
    }
    const isCurrentPage = entry === props.page
    let buttonClasses = idleClasses
    if (isCurrentPage) {
      buttonClasses = currentClasses
    }
    pageButtons.push(
      <li key={entry}>
        <button
          type="button"
          // aria-current tells a screen reader which of these numbers is the
          // page being shown, which the fill color alone cannot say.
          aria-current={isCurrentPage ? 'page' : undefined}
          aria-label={'Page ' + entry}
          onClick={() => props.onPageChange(entry)}
          className={buttonClasses}
        >
          {entry}
        </button>
      </li>,
    )
  }

  return (
    // A nav, because this is navigation between pages of one list, and a labelled
    // one because a page can hold several of these controls.
    <nav
      aria-label={props.label + ' pagination'}
      className="flex flex-col gap-3 mt-6 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="text-sm text-text-muted">
        {describeShownRange(props.page, props.pageSize, props.total)}
      </p>
      <ul className="flex flex-wrap items-center gap-1">
        <li>
          <button
            type="button"
            disabled={isFirstPage}
            onClick={handlePrevious}
            className={isFirstPage ? disabledClasses : idleClasses}
          >
            Prev
          </button>
        </li>
        {pageButtons}
        <li>
          <button
            type="button"
            disabled={isLastPage}
            onClick={handleNext}
            className={isLastPage ? disabledClasses : idleClasses}
          >
            Next
          </button>
        </li>
      </ul>
    </nav>
  )
}

export default Pagination
