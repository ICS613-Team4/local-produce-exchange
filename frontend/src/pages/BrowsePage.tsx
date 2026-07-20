import { useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router'

import { sendBrowseListingsRequest } from '../services/listingService'
import type { BrowseListingFilters, ListingDetail, ListingResult } from '../services/listingService'
import { formatTimestamp, getLocalTimeZoneNote } from '../utils/formatTimestamp'
import MemberRatingChip from '../components/MemberRatingChip'

// The filter choices are the demo vocabulary from backend/app/seed.py. Create
// and edit still allow free-form categories and tags, so for R1 browse only
// exposes these seed values as filter choices.
// ponytail: hardcoded here for R1; serve these from the backend when browse must
// expose user-created categories and tags.
const CATEGORY_OPTIONS = ['Vegetables', 'Fruit', 'Baked goods', 'Dairy and eggs', 'Herbs']
const DIETARY_OPTIONS = ['vegan', 'vegetarian', 'gluten-free']
const ALLERGEN_OPTIONS = ['contains wheat', 'contains eggs', 'contains nuts']

function BrowsePage() {
  // No server session yet, so read the logged-in member's id from localStorage.
  // An empty value means nobody is logged in here.
  const memberId = window.localStorage.getItem('memberId') ?? ''

  // Counts loads so an older response cannot overwrite a newer one.
  const latestRequestNumber = useRef(0)

  const [searchText, setSearchText] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedDietary, setSelectedDietary] = useState<string[]>([])
  const [selectedAllergen, setSelectedAllergen] = useState<string[]>([])

  // Holds the whole response. null means results have not loaded yet, which
  // doubles as the loading state.
  const [result, setResult] = useState<ListingResult | null>(null)

  // Load the full active list when the page opens. The request number keeps an
  // older response from replacing a newer one.
  useEffect(() => {
    if (memberId === '') {
      return
    }
    latestRequestNumber.current = latestRequestNumber.current + 1
    const requestNumber = latestRequestNumber.current
    async function loadAllListings() {
      const loadedResult = await sendBrowseListingsRequest(memberId, {})
      if (requestNumber !== latestRequestNumber.current) {
        return
      }
      setResult(loadedResult)
    }
    loadAllListings()
  }, [memberId])

  // Runs a search with the given filters and stores the response. The Search and
  // Apply buttons and the Clear button all go through here. The request number
  // guards against an older response landing after a newer one.
  async function runSearch(filters: BrowseListingFilters) {
    latestRequestNumber.current = latestRequestNumber.current + 1
    const requestNumber = latestRequestNumber.current
    setResult(null)
    const loadedResult = await sendBrowseListingsRequest(memberId, filters)
    if (requestNumber !== latestRequestNumber.current) {
      return
    }
    setResult(loadedResult)
  }

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
    const filters: BrowseListingFilters = {
      q: searchText,
      category: selectedCategory,
      dietary_tags: selectedDietary,
      allergen_tags: selectedAllergen,
    }
    runSearch(filters)
  }

  // Reset every control to its default, then reload the full active list.
  function handleClear() {
    setSearchText('')
    setSelectedCategory('')
    setSelectedDietary([])
    setSelectedAllergen([])
    runSearch({})
  }

  // Not logged in: send the visitor to the login page, the same guard the create
  // page uses. Returning <Navigate> from render is the correct way.
  if (memberId === '') {
    return <Navigate to="/login" replace />
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

  // The note that tells the viewer the pickup times are in their local zone.
  const timeZoneNote = getLocalTimeZoneNote()

  const inputClasses = 'w-full px-4 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-150'

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
    // The backend owns this shape, so read the body with one plain cast to a
    // list of listings.
    const listings = result.data as ListingDetail[]
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
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {listingCards}
        </ul>
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

      {/* Filters card */}
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

      {/* Results */}
      {resultsArea}
    </section>
  )
}

export default BrowsePage
