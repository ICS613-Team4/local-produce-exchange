import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { sendBrowseListingsRequest } from '../services/listingService'
import type { BrowseListingFilters, ListingDetail, ListingResult } from '../services/listingService'
import { formatTimestamp, getLocalTimeZoneNote } from '../utils/formatTimestamp'
import { DEFAULT_PAGE_SIZE, clampPage, countPages, readPageParam } from '../utils/pagination'
import type { PagedResponse } from '../utils/pagination'
import MemberRatingChip from '../components/MemberRatingChip'
import Pagination from '../components/Pagination'

// The filter choices are the demo vocabulary from backend/app/seed.py. Create
// and edit still allow free-form categories and tags, so for R1 browse only
// exposes these seed values as filter choices.
// ponytail: hardcoded here for R1; serve these from the backend when browse must
// expose user-created categories and tags.
const CATEGORY_OPTIONS = ['Vegetables', 'Fruit', 'Baked goods', 'Dairy and eggs', 'Herbs']
const DIETARY_OPTIONS = ['vegan', 'vegetarian', 'gluten-free']
const ALLERGEN_OPTIONS = ['contains wheat', 'contains eggs', 'contains nuts']

const inputClasses = 'w-full px-4 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-150'

type BrowseFilterFormProps = {
  // What the URL currently asks for. The form starts from these and then owns
  // its own draft until the member applies or clears it.
  initialSearchText: string
  initialCategory: string
  initialDietary: string[]
  initialAllergen: string[]
  // Called with the filters to apply. The page turns them into the URL.
  onApply: (filters: BrowseListingFilters) => void
}

// The search and filter controls. This is a separate component so the page can
// remount it with a key when the URL changes: the draft the member is typing
// belongs to one set of applied filters, and mounting a fresh form is how that
// draft is replaced when the applied filters change under it (a back button, a
// shared link). Nothing here talks to the URL or the API; it hands finished
// filters to the page.
function BrowseFilterForm(props: BrowseFilterFormProps) {
  const [searchText, setSearchText] = useState(props.initialSearchText)
  const [selectedCategory, setSelectedCategory] = useState(props.initialCategory)
  const [selectedDietary, setSelectedDietary] = useState<string[]>(props.initialDietary)
  const [selectedAllergen, setSelectedAllergen] = useState<string[]>(props.initialAllergen)

  function handleSearchTextChange(event: React.ChangeEvent<HTMLInputElement>) {
    setSearchText(event.target.value)
  }

  function handleCategoryChange(event: React.ChangeEvent<HTMLSelectElement>) {
    setSelectedCategory(event.target.value)
  }

  // Toggle one dietary tag in the selected list. Rebuild the list without the
  // tag, then add it back when the box is checked.
  function handleDietaryToggle(event: React.ChangeEvent<HTMLInputElement>) {
    const tagValue = event.target.value
    const isChecked = event.target.checked
    const newSelected: string[] = []
    for (let index = 0; index < selectedDietary.length; index = index + 1) {
      if (selectedDietary[index] !== tagValue) {
        newSelected.push(selectedDietary[index])
      }
    }
    if (isChecked) {
      newSelected.push(tagValue)
    }
    setSelectedDietary(newSelected)
  }

  function handleAllergenToggle(event: React.ChangeEvent<HTMLInputElement>) {
    const tagValue = event.target.value
    const isChecked = event.target.checked
    const newSelected: string[] = []
    for (let index = 0; index < selectedAllergen.length; index = index + 1) {
      if (selectedAllergen[index] !== tagValue) {
        newSelected.push(selectedAllergen[index])
      }
    }
    if (isChecked) {
      newSelected.push(tagValue)
    }
    setSelectedAllergen(newSelected)
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    props.onApply({
      q: searchText,
      category: selectedCategory,
      dietary_tags: selectedDietary,
      allergen_tags: selectedAllergen,
    })
  }

  // Reset every control to its default, then reload the full active list from
  // page 1. Clearing the filters is a filter change like any other, so it goes
  // through the URL too.
  function handleClear() {
    setSearchText('')
    setSelectedCategory('')
    setSelectedDietary([])
    setSelectedAllergen([])
    props.onApply({})
  }

  // Build the category dropdown options, with a blank "all categories" first.
  const categoryOptionElements = []
  categoryOptionElements.push(
    <option key="all-categories" value="">
      All categories
    </option>,
  )
  for (let index = 0; index < CATEGORY_OPTIONS.length; index = index + 1) {
    const categoryName = CATEGORY_OPTIONS[index]
    categoryOptionElements.push(
      <option key={categoryName} value={categoryName}>
        {categoryName}
      </option>,
    )
  }

  // Build the dietary tag checkboxes.
  const dietaryCheckboxes = []
  for (let index = 0; index < DIETARY_OPTIONS.length; index = index + 1) {
    const tagName = DIETARY_OPTIONS[index]
    const isChecked = selectedDietary.includes(tagName)
    dietaryCheckboxes.push(
      <label key={tagName} className="inline-flex items-center gap-2 text-sm text-text cursor-pointer">
        <input
          type="checkbox"
          value={tagName}
          checked={isChecked}
          onChange={handleDietaryToggle}
          className="w-4 h-4 rounded border-border text-primary-600 focus:ring-primary-500"
        />
        {tagName}
      </label>,
    )
  }

  // Build the allergen tag checkboxes.
  const allergenCheckboxes = []
  for (let index = 0; index < ALLERGEN_OPTIONS.length; index = index + 1) {
    const tagName = ALLERGEN_OPTIONS[index]
    const isChecked = selectedAllergen.includes(tagName)
    allergenCheckboxes.push(
      <label key={tagName} className="inline-flex items-center gap-2 text-sm text-text cursor-pointer">
        <input
          type="checkbox"
          value={tagName}
          checked={isChecked}
          onChange={handleAllergenToggle}
          className="w-4 h-4 rounded border-border text-primary-600 focus:ring-primary-500"
        />
        {tagName}
      </label>,
    )
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-6 shadow-sm mb-8">
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Search + Category row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="browse-search" className="block text-sm font-medium text-text mb-1.5">Search</label>
            <input
              id="browse-search"
              type="text"
              value={searchText}
              onChange={handleSearchTextChange}
              className={inputClasses}
              placeholder="Search titles and descriptions…"
            />
          </div>
          <div>
            <label htmlFor="browse-category" className="block text-sm font-medium text-text mb-1.5">Category</label>
            <select
              id="browse-category"
              value={selectedCategory}
              onChange={handleCategoryChange}
              className={inputClasses}
            >
              {categoryOptionElements}
            </select>
          </div>
        </div>

        {/* Tag filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <fieldset>
            <legend className="text-sm font-medium text-text mb-2">Dietary tags</legend>
            <div className="flex flex-wrap gap-4">
              {dietaryCheckboxes}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-medium text-text mb-2">Allergen tags</legend>
            <div className="flex flex-wrap gap-4">
              {allergenCheckboxes}
            </div>
            <p className="text-xs text-text-muted mt-2">
              Shows listings that carry the tag, not listings that avoid it.
            </p>
          </fieldset>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            className="inline-flex items-center px-6 py-2.5 text-sm font-semibold text-text-inverse bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm transition-all duration-150"
          >
            Apply filters
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="inline-flex items-center px-6 py-2.5 text-sm font-medium text-text-muted border border-border rounded-lg hover:bg-background-alt transition-colors"
          >
            Clear
          </button>
        </div>
      </form>
    </div>
  )
}

function BrowsePage() {
  // No server session yet, so read the logged-in member's id from localStorage.
  // An empty value means nobody is logged in here.
  const memberId = window.localStorage.getItem('memberId') ?? ''

  // Counts loads so an older response cannot overwrite a newer one.
  const latestRequestNumber = useRef(0)

  // The URL holds the filters AND the page number, so it fully describes what
  // the member is looking at (US-33). That makes a filtered page 3 a link worth
  // sending, makes the back button walk back through the pages the member
  // actually visited, and means a reload shows the same screen. React state
  // could hold none of that: it is thrown away the moment the member navigates.
  const [searchParams, setSearchParams] = useSearchParams()
  // The query string as one plain string. The effect below depends on this
  // rather than on the searchParams object, because a new object is handed out
  // on every render while this value only changes when the URL really does.
  const currentQueryText = searchParams.toString()

  // What the URL is currently asking for. These are the APPLIED filters, which
  // is what gets fetched; the form controls hold their own draft copy, because
  // typing in the search box must not fire a request per keystroke.
  const appliedSearchText = searchParams.get('q') ?? ''
  const appliedCategory = searchParams.get('category') ?? ''
  const appliedDietary = searchParams.getAll('dietary_tags')
  const appliedAllergen = searchParams.getAll('allergen_tags')

  // The response, together with the query text it answers. Keeping the two in
  // one value is what lets the render below tell "still loading the new URL"
  // apart from "loaded", without clearing the old result first: while these
  // disagree, the result on hand describes a URL the member has already left.
  const [load, setLoad] = useState<{ queryText: string; result: ListingResult } | null>(null)

  // Load the window the URL asks for, and load it again whenever the URL
  // changes, whether that came from a filter, a page button, or the back
  // button. The request number keeps an older response from replacing a newer
  // one. The effect reads the filters back out of the query text it depends on,
  // so what is fetched is always exactly what the URL says.
  useEffect(() => {
    latestRequestNumber.current = latestRequestNumber.current + 1
    const requestNumber = latestRequestNumber.current
    const queryText = currentQueryText
    const urlParams = new URLSearchParams(queryText)
    const filters: BrowseListingFilters = {
      q: urlParams.get('q') ?? '',
      category: urlParams.get('category') ?? '',
      dietary_tags: urlParams.getAll('dietary_tags'),
      allergen_tags: urlParams.getAll('allergen_tags'),
      page: readPageParam(urlParams, 'page'),
      page_size: DEFAULT_PAGE_SIZE,
    }
    async function loadListings() {
      const loadedResult = await sendBrowseListingsRequest(memberId, filters)
      if (requestNumber !== latestRequestNumber.current) {
        return
      }
      setLoad({ queryText: queryText, result: loadedResult })
    }
    loadListings()
  }, [memberId, currentQueryText])

  // The result to render, or null while the current URL's answer is still on
  // its way.
  let result: ListingResult | null = null
  if (load !== null && load.queryText === currentQueryText) {
    result = load.result
  }

  // A page past the end (a stale bookmark, or a filter that shortened the list)
  // comes back empty with the true total behind it. Send the member to the last
  // real page instead of showing them nothing (Scenario 6). This replaces the
  // history entry instead of adding one, so the back button goes where the
  // member came from rather than to the out-of-range URL they never chose.
  useEffect(() => {
    if (load === null || load.queryText !== currentQueryText || load.result.ok === false) {
      return
    }
    const pagedListings = load.result.data as PagedResponse<ListingDetail>
    const totalPages = countPages(pagedListings.total, pagedListings.page_size)
    const pageToShow = clampPage(pagedListings.page, totalPages)
    if (pageToShow === pagedListings.page) {
      return
    }
    const clampedParams = new URLSearchParams(currentQueryText)
    clampedParams.set('page', String(pageToShow))
    setSearchParams(clampedParams, { replace: true })
  }, [load, currentQueryText, setSearchParams])

  // Apply a new set of filters. The page always goes back to 1, because the
  // member is now looking at a different list and page 3 of the old list means
  // nothing in the new one (Scenario 3). The filters and page=1 land in the URL
  // together, and the load effect above picks them up from there.
  function applyFilters(filters: BrowseListingFilters) {
    const nextParams = new URLSearchParams()
    if (filters.q !== undefined && filters.q !== '') {
      nextParams.set('q', filters.q)
    }
    if (filters.category !== undefined && filters.category !== '') {
      nextParams.set('category', filters.category)
    }
    if (filters.dietary_tags !== undefined) {
      for (let index = 0; index < filters.dietary_tags.length; index = index + 1) {
        nextParams.append('dietary_tags', filters.dietary_tags[index])
      }
    }
    if (filters.allergen_tags !== undefined) {
      for (let index = 0; index < filters.allergen_tags.length; index = index + 1) {
        nextParams.append('allergen_tags', filters.allergen_tags[index])
      }
    }
    nextParams.set('page', '1')
    setSearchParams(nextParams)
  }

  // Move to another page of the SAME list, so every filter in the URL stays put
  // and only the page number changes.
  function handlePageChange(nextPage: number) {
    const nextParams = new URLSearchParams(currentQueryText)
    nextParams.set('page', String(nextPage))
    setSearchParams(nextParams)
  }

  // The note that tells the viewer the pickup times are in their local zone.
  const timeZoneNote = getLocalTimeZoneNote()

  // Build the results area with a plain if/else chain, checked in a set order.
  let resultsArea
  if (result === null) {
    resultsArea = <p className="text-text-muted text-sm py-8 text-center">Loading listings...</p>
  } else if (result.errorMessage !== '') {
    // A transport failure (timeout or network error); status is 0 here.
    resultsArea = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
        {result.errorMessage}
      </div>
    )
  } else if (result.ok) {
    // The backend owns this shape, so read the body with one plain cast to the
    // paged envelope: this window's listings plus how many matched in total.
    const pagedListings = result.data as PagedResponse<ListingDetail>
    const listings = pagedListings.items
    const totalListings = pagedListings.total
    if (listings.length === 0) {
      // US-06 Scenario 2: nothing matched the search or filters.
      resultsArea = (
        <div className="text-center py-12">
          <span className="text-4xl mb-4 block">🍃</span>
          <p className="text-text-muted">No listings match your search.</p>
        </div>
      )
    } else {
      const listingCards = []
      for (let index = 0; index < listings.length; index = index + 1) {
        const listing = listings[index]
        let dietaryText = listing.dietary_tags.join(', ')
        if (dietaryText === '') {
          dietaryText = 'None'
        }
        let allergenText = listing.allergen_tags.join(', ')
        if (allergenText === '') {
          allergenText = 'None'
        }
        const pickupStartText = formatTimestamp(listing.pickup_start)
        const pickupEndText = formatTimestamp(listing.pickup_end)
        // The footer names who posted the listing on one line and the posted
        // time on the line below it. When the backend sent no owner name, the
        // first line is just "Posted".
        let postedByLine = 'Posted'
        if (typeof listing.owner_name === 'string' && listing.owner_name !== '') {
          postedByLine = 'Posted by ' + listing.owner_name
        }
        // The owner's rating AS a listing owner (US-20), rendered inline right
        // after the owner's name. No reviews yet renders nothing, never a bare
        // zero.
        let ownerRatingAverage = null
        if (listing.owner_rating_average !== undefined && listing.owner_rating_average !== null) {
          ownerRatingAverage = listing.owner_rating_average
        }
        let ownerRatingCount = 0
        if (listing.owner_rating_count !== undefined) {
          ownerRatingCount = listing.owner_rating_count
        }
        const postedAtText = formatTimestamp(listing.created_at)
        let coverPhotoArea = null
        if (listing.photos !== undefined && listing.photos.length > 0) {
          coverPhotoArea = (
            <img
              src={'/api/photos/' + listing.photos[0].id}
              alt={listing.title}
              loading="lazy"
              className="w-full aspect-video object-cover rounded-lg border border-border mb-4"
            />
          )
        }
        listingCards.push(
          <li key={listing.id}>
            {/* The grid stretches every cell in a row to the same height, so the
                card fills its cell (h-full) and flexes as a column, with the
                posted-on footer pushed to the bottom (mt-auto). That keeps all
                cards in a row equal height at every screen size. */}
            <article className="h-full flex flex-col bg-surface rounded-xl border border-border p-6 shadow-sm hover:shadow-md transition-shadow duration-200">
              {coverPhotoArea}
              <div className="flex items-start justify-between mb-3">
                <h2 className="text-lg font-semibold text-text">
                  <Link to={'/listings/' + listing.id} className="hover:text-primary-600 transition-colors">
                    {listing.title}
                  </Link>
                </h2>
                {listing.category && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 shrink-0 ml-3">
                    {listing.category}
                  </span>
                )}
              </div>
              <div className="space-y-1.5 text-sm text-text-muted mb-4">
                <p>Remaining: <span className="font-medium text-text">{listing.remaining_quantity}</span></p>
                <p>Dietary: {dietaryText}</p>
                <p>Allergens: {allergenText}</p>
                <p>
                  Pickup: {pickupStartText} — {pickupEndText}
                </p>
                <p className="text-xs">{timeZoneNote}</p>
              </div>
              <div className="mt-auto pt-3 border-t border-border">
                <p className="text-xs text-text-muted">
                  {postedByLine}{' '}
                  <MemberRatingChip
                    memberId={listing.owner_id}
                    role="listing_owner"
                    average={ownerRatingAverage}
                    count={ownerRatingCount}
                  />
                </p>
                <p className="text-xs text-text-muted mt-0.5">{postedAtText}</p>
              </div>
            </article>
          </li>,
        )
      }
      resultsArea = (
        <>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {listingCards}
          </ul>
          {/* Renders nothing when every match fits on one page. */}
          <Pagination
            page={pagedListings.page}
            pageSize={pagedListings.page_size}
            total={totalListings}
            onPageChange={handlePageChange}
            label="Listings"
          />
        </>
      )
    }
  } else {
    // Any other HTTP failure (for example 403 or 503). Show the backend's detail
    // message when it sent one.
    let detail: unknown = undefined
    if (typeof result.data === 'object' && result.data !== null) {
      const dataObject = result.data as { detail?: unknown }
      detail = dataObject.detail
    }
    let detailMessage = 'Could not load listings (HTTP ' + result.status + ').'
    if (typeof detail === 'string') {
      detailMessage = detail
    }
    resultsArea = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
        {detailMessage}
      </div>
    )
  }

  return (
    <section>
      <h1 className="text-3xl font-bold text-text mb-6">Browse listings</h1>

      {/* Filters card. The key is the current query string, so any change to the
          URL (a filter, a page button, or the back button) mounts a fresh form
          whose controls start from what the URL now says. That is what keeps the
          boxes agreeing with the results being shown, with no copying back and
          forth between the URL and the form's own state. */}
      <BrowseFilterForm
        key={currentQueryText}
        initialSearchText={appliedSearchText}
        initialCategory={appliedCategory}
        initialDietary={appliedDietary}
        initialAllergen={appliedAllergen}
        onApply={applyFilters}
      />

      {/* Results */}
      {resultsArea}
    </section>
  )
}

export default BrowsePage
