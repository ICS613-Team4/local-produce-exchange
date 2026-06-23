import { useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router'

import { sendBrowseListingsRequest } from '../services/listingService'
import type { BrowseListingFilters, ListingDetail, ListingResult } from '../services/listingService'
import { formatTimestamp } from '../utils/formatTimestamp'

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
      <label key={tagName} style={{ marginRight: '10px' }}>
        <input type="checkbox" value={tagName} checked={isChecked} onChange={handleDietaryToggle} />{' '}
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
      <label key={tagName} style={{ marginRight: '10px' }}>
        <input type="checkbox" value={tagName} checked={isChecked} onChange={handleAllergenToggle} />{' '}
        {tagName}
      </label>,
    )
  }

  // Build the results area with a plain if/else chain, checked in a set order.
  let resultsArea
  if (result === null) {
    resultsArea = <p>Loading listings...</p>
  } else if (result.errorMessage !== '') {
    // A transport failure (timeout or network error); status is 0 here.
    resultsArea = <p role="alert">{result.errorMessage}</p>
  } else if (result.ok) {
    // The backend owns this shape, so read the body with one plain cast to a
    // list of listings.
    const listings = result.data as ListingDetail[]
    if (listings.length === 0) {
      // US-06 Scenario 2: nothing matched the search or filters.
      resultsArea = <p>No listings match.</p>
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
        listingCards.push(
          <li key={listing.id}>
            <article>
              <h2>
                <Link to={'/listings/' + listing.id}>{listing.title}</Link>
              </h2>
              <p>Category: {listing.category}</p>
              <p>Remaining quantity: {listing.remaining_quantity}</p>
              <p>Dietary tags: {dietaryText}</p>
              <p>Allergen tags: {allergenText}</p>
              <p>
                Pickup: {pickupStartText} to {pickupEndText}
              </p>
            </article>
          </li>,
        )
      }
      resultsArea = <ul>{listingCards}</ul>
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
    resultsArea = <p role="alert">{detailMessage}</p>
  }

  return (
    <section>
      <h1>Browse listings</h1>
      <form onSubmit={handleSubmit}>
        <p>
          <label htmlFor="browse-search">Search</label>{' '}
          <input id="browse-search" type="text" value={searchText} onChange={handleSearchTextChange} />{' '}
          <button type="submit">Search</button>
        </p>
        <p>
          <label htmlFor="browse-category">Category</label>{' '}
          <select id="browse-category" value={selectedCategory} onChange={handleCategoryChange}>
            {categoryOptionElements}
          </select>
        </p>
        <fieldset>
          <legend>Dietary tags</legend>
          {dietaryCheckboxes}
        </fieldset>
        <fieldset>
          <legend>Allergen tags</legend>
          {allergenCheckboxes}
          <p>
            <small>
              The allergen filter shows listings that carry the tag, not listings that avoid it.
            </small>
          </p>
        </fieldset>
        <p>
          <button type="submit">Apply filters</button>{' '}
          <button type="button" onClick={handleClear}>
            Clear
          </button>
        </p>
      </form>
      {resultsArea}
    </section>
  )
}

export default BrowsePage
