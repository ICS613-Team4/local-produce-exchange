// The shared paging pieces every paged page on the site uses (US-33): the one
// page-size number, the shape the paged endpoints answer with, and the small
// number helpers the Pagination component and the pages are built from.
//
// The helpers are plain functions of their inputs with no React and no fetch, so
// the awkward cases (a hand-edited ?page=abc, a page past the end, a list that
// fits on one page) are settled in one place and can be tested directly.

// Every paged page shows 12 rows unless a caller says otherwise. The backend
// keeps its own copy of this number in backend/app/pagination.py; keep the two
// in step.
export const DEFAULT_PAGE_SIZE = 12

// The envelope every paged endpoint returns. items is the current window,
// total is how many rows matched across every page, and page and page_size are
// the window the backend actually used, which is what lets a page show
// "Showing 13-24 of 40" without a second request.
export type PagedResponse<ItemType> = {
  items: ItemType[]
  total: number
  page: number
  page_size: number
}

// What buildPageList returns: either a page number to render as a button, or a
// gap standing in for the pages it skipped over.
export type PageListEntry = number | 'gap'

export function readPageParam(searchParams: URLSearchParams, paramName: string): number {
  // The page number from the URL, which is the only place the current page
  // lives, so a page is bookmarkable and the back button works.
  //
  // Anything that is not a whole number of at least 1 reads as page 1: a
  // missing param (the normal first visit), an empty one, a word, a decimal, or
  // a zero or negative number. A member who hand-edits the URL gets the first
  // page rather than an error, and the request that follows always carries a
  // value the API accepts.
  const rawValue = searchParams.get(paramName)
  if (rawValue === null || rawValue.trim() === '') {
    return 1
  }
  // Number() is stricter than parseInt here on purpose: parseInt('2abc') is 2,
  // which would quietly accept a broken URL, while Number('2abc') is NaN.
  const parsedValue = Number(rawValue)
  if (Number.isInteger(parsedValue) === false) {
    return 1
  }
  if (parsedValue < 1) {
    return 1
  }
  return parsedValue
}

export function countPages(total: number, pageSize: number): number {
  // How many pages the list needs. An empty list is one (empty) page, so the
  // callers below never have to reason about a zero-page list; a page count of
  // 1 is also what tells the Pagination component to render nothing.
  if (total <= 0) {
    return 1
  }
  if (pageSize <= 0) {
    return 1
  }
  return Math.ceil(total / pageSize)
}

export function clampPage(page: number, totalPages: number): number {
  // Keep a page number inside the list's real range. The backend answers a page
  // past the end honestly, with no rows and the true total; this is what the
  // pages use to turn that answer into the last real page and show its rows
  // instead of an empty screen (Scenario 6).
  if (page < 1) {
    return 1
  }
  if (page > totalPages) {
    return totalPages
  }
  return page
}

export function describeShownRange(page: number, pageSize: number, total: number): string {
  // The count line, like "Showing 13-24 of 40". The last page is usually short,
  // so the end of the range is capped at the total instead of page * page_size.
  if (total <= 0) {
    return 'Showing 0 of 0'
  }
  const firstShown = (page - 1) * pageSize + 1
  let lastShown = page * pageSize
  if (lastShown > total) {
    lastShown = total
  }
  return 'Showing ' + firstShown + '-' + lastShown + ' of ' + total
}

export function buildPageList(currentPage: number, totalPages: number): PageListEntry[] {
  // Which page numbers to draw. A short list shows every page. A long one shows
  // the first page, the last page, and the current page with one neighbour on
  // each side, with a gap standing in for each run of pages left out, so the
  // control stays a fixed width no matter how many pages there are:
  //
  //   1 ... 6 7 8 ... 20
  //
  // Seven is the widest run this can produce (first, gap, three around the
  // current page, gap, last), so any list of seven or fewer pages is cheaper to
  // show in full than to abbreviate.
  const entries: PageListEntry[] = []
  if (totalPages <= 7) {
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber = pageNumber + 1) {
      entries.push(pageNumber)
    }
    return entries
  }

  // The window around the current page, pulled back inside the ends so a
  // current page at either end still shows three numbers rather than trailing
  // off the edge.
  let windowStart = currentPage - 1
  let windowEnd = currentPage + 1
  if (windowStart < 2) {
    windowStart = 2
    windowEnd = 4
  }
  if (windowEnd > totalPages - 1) {
    windowEnd = totalPages - 1
    windowStart = totalPages - 3
  }

  entries.push(1)
  // A gap only earns its place when it hides more than one page. With exactly
  // one page missing, that page's own number is shown instead, because a gap
  // standing in for a single page would be wider than the number it replaced.
  if (windowStart > 3) {
    entries.push('gap')
  } else if (windowStart === 3) {
    entries.push(2)
  }
  for (let pageNumber = windowStart; pageNumber <= windowEnd; pageNumber = pageNumber + 1) {
    entries.push(pageNumber)
  }
  if (windowEnd < totalPages - 2) {
    entries.push('gap')
  } else if (windowEnd === totalPages - 2) {
    entries.push(totalPages - 1)
  }
  entries.push(totalPages)
  return entries
}
