import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'

import { authStateChangedEventName } from '../services/authService'
import { sendGetListingRequest, sendUpdateListingRequest } from '../services/listingService'
import type { ListingDetail, ListingResult } from '../services/listingService'

const notLoggedInMessage = 'You need to be logged in to see this page.'

function padTwoDigits(value: number) {
  let text = String(value)
  if (text.length === 1) {
    text = '0' + text
  }
  return text
}

function isoToLocalInputValue(isoText: string) {
  const dateValue = new Date(isoText)
  if (Number.isNaN(dateValue.getTime())) {
    return ''
  }

  const yearText = String(dateValue.getFullYear())
  const monthText = padTwoDigits(dateValue.getMonth() + 1)
  const dayText = padTwoDigits(dateValue.getDate())
  const hourText = padTwoDigits(dateValue.getHours())
  const minuteText = padTwoDigits(dateValue.getMinutes())
  return yearText + '-' + monthText + '-' + dayText + 'T' + hourText + ':' + minuteText
}

function hasListingResponseShape(data: unknown) {
  if (typeof data !== 'object' || data === null) {
    return false
  }

  const dataObject = data as {
    id?: unknown
    owner_id?: unknown
    title?: unknown
    description?: unknown
    category?: unknown
    total_quantity?: unknown
    remaining_quantity?: unknown
    dietary_tags?: unknown
    allergen_tags?: unknown
    pickup_start?: unknown
    pickup_end?: unknown
    status?: unknown
    created_at?: unknown
  }

  if (typeof dataObject.id !== 'string') {
    return false
  }
  if (typeof dataObject.owner_id !== 'string') {
    return false
  }
  if (typeof dataObject.title !== 'string') {
    return false
  }
  if (typeof dataObject.description !== 'string') {
    return false
  }
  if (typeof dataObject.category !== 'string') {
    return false
  }
  if (typeof dataObject.total_quantity !== 'number') {
    return false
  }
  if (typeof dataObject.remaining_quantity !== 'number') {
    return false
  }
  if (!Array.isArray(dataObject.dietary_tags)) {
    return false
  }
  if (!Array.isArray(dataObject.allergen_tags)) {
    return false
  }
  if (typeof dataObject.pickup_start !== 'string') {
    return false
  }
  if (typeof dataObject.pickup_end !== 'string') {
    return false
  }
  if (typeof dataObject.status !== 'string') {
    return false
  }
  if (typeof dataObject.created_at !== 'string') {
    return false
  }
  return true
}

function EditListingPage() {
  const latestRequestNumber = useRef(0)

  const params = useParams()
  const listingId = params.id ?? ''

  const [memberId, setMemberId] = useState(window.localStorage.getItem('memberId') ?? '')
  const [memberName, setMemberName] = useState(window.localStorage.getItem('memberName') ?? '')

  const [result, setResult] = useState<ListingResult | null>(null)
  const [resultListingId, setResultListingId] = useState('')

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [totalQuantity, setTotalQuantity] = useState('')
  const [dietaryTags, setDietaryTags] = useState('')
  const [allergenTags, setAllergenTags] = useState('')
  const [pickupStart, setPickupStart] = useState('')
  const [pickupEnd, setPickupEnd] = useState('')

  const [successMessage, setSuccessMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const clearStoredLogin = useCallback(() => {
    window.localStorage.removeItem('memberId')
    window.localStorage.removeItem('memberName')
    window.localStorage.removeItem('memberEmail')
    setMemberId('')
    setMemberName('')
    // The route is not changing on a stale 401, so tell the shared nav the
    // login was cleared by firing the same-tab event it listens for.
    window.dispatchEvent(new Event(authStateChangedEventName))
  }, [])

  const fillFormFromListing = useCallback((listing: ListingDetail) => {
    setTitle(listing.title)
    setDescription(listing.description)
    setCategory(listing.category)
    setTotalQuantity(String(listing.total_quantity))
    setDietaryTags(listing.dietary_tags.join(', '))
    setAllergenTags(listing.allergen_tags.join(', '))
    setPickupStart(isoToLocalInputValue(listing.pickup_start))
    setPickupEnd(isoToLocalInputValue(listing.pickup_end))
  }, [])

  useEffect(() => {
    latestRequestNumber.current = latestRequestNumber.current + 1

    if (memberId === '') {
      return
    }

    const requestNumber = latestRequestNumber.current
    async function loadListing() {
      const loadedResult = await sendGetListingRequest(listingId, memberId)
      if (requestNumber !== latestRequestNumber.current) {
        return
      }
      if (loadedResult.status === 401) {
        clearStoredLogin()
        return
      }
      setSuccessMessage('')
      setErrorMessage('')
      setIsSubmitting(false)
      setResult(loadedResult)
      setResultListingId(listingId)
      if (loadedResult.ok && hasListingResponseShape(loadedResult.data)) {
        const loadedListing = loadedResult.data as ListingDetail
        fillFormFromListing(loadedListing)
      }
    }
    loadListing()
  }, [listingId, memberId, clearStoredLogin, fillFormFromListing])

  function clearStaleSuccessMessage() {
    setSuccessMessage('')
  }

  function handleTitleChange(event: React.ChangeEvent<HTMLInputElement>) {
    setTitle(event.target.value)
    clearStaleSuccessMessage()
  }

  function handleDescriptionChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    setDescription(event.target.value)
    clearStaleSuccessMessage()
  }

  function handleCategoryChange(event: React.ChangeEvent<HTMLInputElement>) {
    setCategory(event.target.value)
    clearStaleSuccessMessage()
  }

  function handleTotalQuantityChange(event: React.ChangeEvent<HTMLInputElement>) {
    setTotalQuantity(event.target.value)
    clearStaleSuccessMessage()
  }

  function handleDietaryTagsChange(event: React.ChangeEvent<HTMLInputElement>) {
    setDietaryTags(event.target.value)
    clearStaleSuccessMessage()
  }

  function handleAllergenTagsChange(event: React.ChangeEvent<HTMLInputElement>) {
    setAllergenTags(event.target.value)
    clearStaleSuccessMessage()
  }

  function handlePickupStartChange(event: React.ChangeEvent<HTMLInputElement>) {
    setPickupStart(event.target.value)
    clearStaleSuccessMessage()
  }

  function handlePickupEndChange(event: React.ChangeEvent<HTMLInputElement>) {
    setPickupEnd(event.target.value)
    clearStaleSuccessMessage()
  }

  function splitTags(rawValue: string) {
    const pieces = rawValue.split(',')
    const tags = []
    for (let index = 0; index < pieces.length; index = index + 1) {
      const trimmedTag = pieces[index].trim()
      if (trimmedTag !== '') {
        tags.push(trimmedTag)
      }
    }
    return tags
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSubmitting(true)
    setSuccessMessage('')
    setErrorMessage('')

    const pickupStartIso = new Date(pickupStart).toISOString()
    const pickupEndIso = new Date(pickupEnd).toISOString()
    const totalQuantityNumber = Number(totalQuantity)

    const listingFields = {
      title: title,
      description: description,
      category: category,
      total_quantity: totalQuantityNumber,
      dietary_tags: splitTags(dietaryTags),
      allergen_tags: splitTags(allergenTags),
      pickup_start: pickupStartIso,
      pickup_end: pickupEndIso,
    }

    const savedResult = await sendUpdateListingRequest(listingId, memberId, listingFields)

    if (savedResult.ok) {
      setIsSubmitting(false)
      setSuccessMessage('Your changes were saved.')
      setErrorMessage('')
      if (hasListingResponseShape(savedResult.data)) {
        const savedListing = savedResult.data as ListingDetail
        setResult(savedResult)
        setResultListingId(listingId)
        fillFormFromListing(savedListing)
      }
      return
    }

    setIsSubmitting(false)

    if (savedResult.status === 401) {
      clearStoredLogin()
      return
    }

    if (savedResult.errorMessage !== '') {
      setErrorMessage(savedResult.errorMessage)
      return
    }

    let detail: unknown = undefined
    if (typeof savedResult.data === 'object' && savedResult.data !== null) {
      const dataObject = savedResult.data as { detail?: unknown }
      detail = dataObject.detail
    }

    if (typeof detail === 'string') {
      setErrorMessage(detail)
    } else if (Array.isArray(detail)) {
      setErrorMessage('Please check your entries and try again.')
    } else {
      setErrorMessage('Could not save your changes (HTTP ' + savedResult.status + ').')
    }
  }

  // Show a short status line when logged in. The shared nav owns the log in and
  // log out controls now, so a logged-out viewer needs nothing here.
  let loggedInArea = null
  if (memberId !== '') {
    let loggedInLine = 'Logged in.'
    if (memberName !== '') {
      loggedInLine = 'Logged in as ' + memberName + '.'
    }
    loggedInArea = <p>{loggedInLine}</p>
  }

  let contentArea
  if (memberId === '') {
    contentArea = <p role="alert">{notLoggedInMessage}</p>
  } else if (result === null || resultListingId !== listingId) {
    contentArea = <p>Loading the listing...</p>
  } else if (result.errorMessage !== '') {
    contentArea = <p role="alert">{result.errorMessage}</p>
  } else if (result.ok) {
    const listing = result.data as ListingDetail
    if (listing.owner_id !== memberId) {
      contentArea = <p role="alert">You can only edit your own listing.</p>
    } else {
      let successArea = <></>
      if (successMessage !== '') {
        successArea = (
          <>
            <p>{successMessage}</p>
            <p>
              <Link to={'/listings/' + listing.id}>View the updated listing</Link>
            </p>
          </>
        )
      }

      let errorArea = <></>
      if (errorMessage !== '') {
        errorArea = <p role="alert">{errorMessage}</p>
      }

      contentArea = (
        <>
          {successArea}
          {errorArea}
          <form onSubmit={handleSubmit}>
            <p>
              <label htmlFor="listing-title">Title</label>{' '}
              <input
                id="listing-title"
                type="text"
                required
                value={title}
                onChange={handleTitleChange}
              />
            </p>
            <p>
              <label htmlFor="listing-description">Description</label>{' '}
              <textarea
                id="listing-description"
                required
                value={description}
                onChange={handleDescriptionChange}
              />
            </p>
            <p>
              <label htmlFor="listing-category">Category</label>{' '}
              <input
                id="listing-category"
                type="text"
                required
                value={category}
                onChange={handleCategoryChange}
              />
            </p>
            <p>
              <label htmlFor="listing-quantity">Quantity available</label>{' '}
              <input
                id="listing-quantity"
                type="number"
                required
                min="1"
                step="1"
                value={totalQuantity}
                onChange={handleTotalQuantityChange}
              />
            </p>
            <p>
              <label htmlFor="listing-dietary">Dietary tags (comma-separated)</label>{' '}
              <input
                id="listing-dietary"
                type="text"
                value={dietaryTags}
                onChange={handleDietaryTagsChange}
              />
            </p>
            <p>
              <label htmlFor="listing-allergen">Allergen tags (comma-separated)</label>{' '}
              <input
                id="listing-allergen"
                type="text"
                value={allergenTags}
                onChange={handleAllergenTagsChange}
              />
            </p>
            <p>
              <label htmlFor="listing-pickup-start">Pickup start</label>{' '}
              <input
                id="listing-pickup-start"
                type="datetime-local"
                required
                value={pickupStart}
                onChange={handlePickupStartChange}
              />
            </p>
            <p>
              <label htmlFor="listing-pickup-end">Pickup end</label>{' '}
              <input
                id="listing-pickup-end"
                type="datetime-local"
                required
                min={pickupStart}
                value={pickupEnd}
                onChange={handlePickupEndChange}
              />
            </p>
            <button type="submit" disabled={isSubmitting}>
              Save changes
            </button>
          </form>
        </>
      )
    }
  } else if (result.status === 404) {
    contentArea = <p role="alert">This listing is unavailable.</p>
  } else {
    let detail: unknown = undefined
    if (typeof result.data === 'object' && result.data !== null) {
      const dataObject = result.data as { detail?: unknown }
      detail = dataObject.detail
    }
    let detailMessage = 'Could not load the listing (HTTP ' + result.status + ').'
    if (typeof detail === 'string') {
      detailMessage = detail
    }
    contentArea = <p role="alert">{detailMessage}</p>
  }

  return (
    <section>
      <h1>Edit listing</h1>
      {loggedInArea}
      {contentArea}
    </section>
  )
}

export default EditListingPage
