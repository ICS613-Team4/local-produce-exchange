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

  // The shared nav shows who is logged in, so this page keeps only the name
  // setter, which the 401 paths use to clear a stale session.
  const [memberId, setMemberId] = useState(window.localStorage.getItem('memberId') ?? '')
  const [, setMemberName] = useState(window.localStorage.getItem('memberName') ?? '')

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

  const inputClasses = 'w-full px-4 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-150'
  const labelClasses = 'block text-sm font-medium text-text mb-1.5'

  let contentArea
  if (memberId === '') {
    contentArea = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
        {notLoggedInMessage}
      </div>
    )
  } else if (result === null || resultListingId !== listingId) {
    contentArea = <p className="text-text-muted text-sm">Loading the listing...</p>
  } else if (result.errorMessage !== '') {
    contentArea = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
        {result.errorMessage}
      </div>
    )
  } else if (result.ok) {
    const listing = result.data as ListingDetail
    if (listing.owner_id !== memberId) {
      contentArea = (
        <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
          You can only edit your own listing.
        </div>
      )
    } else {
      let successArea = <></>
      if (successMessage !== '') {
        successArea = (
          <div className="rounded-lg bg-success-bg border border-green-200 px-4 py-3 text-sm text-success mb-4">
            <p className="font-medium">{successMessage}</p>
            <Link
              to={'/listings/' + listing.id}
              className="text-primary-600 hover:text-primary-700 font-medium mt-1 inline-block"
            >
              View the updated listing →
            </Link>
          </div>
        )
      }

      let errorArea = <></>
      if (errorMessage !== '') {
        errorArea = (
          <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error mb-4" role="alert">
            {errorMessage}
          </div>
        )
      }

      contentArea = (
        <>
          {successArea}
          {errorArea}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="listing-title" className={labelClasses}>Title</label>
              <input
                id="listing-title"
                type="text"
                required
                value={title}
                onChange={handleTitleChange}
                className={inputClasses}
              />
            </div>
            <div>
              <label htmlFor="listing-description" className={labelClasses}>Description</label>
              <textarea
                id="listing-description"
                required
                value={description}
                onChange={handleDescriptionChange}
                className={inputClasses + ' min-h-[100px] resize-y'}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="listing-category" className={labelClasses}>Category</label>
                <input
                  id="listing-category"
                  type="text"
                  required
                  value={category}
                  onChange={handleCategoryChange}
                  className={inputClasses}
                />
              </div>
              <div>
                <label htmlFor="listing-quantity" className={labelClasses}>Quantity available</label>
                <input
                  id="listing-quantity"
                  type="number"
                  required
                  min="1"
                  step="1"
                  value={totalQuantity}
                  onChange={handleTotalQuantityChange}
                  className={inputClasses}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="listing-dietary" className={labelClasses}>Dietary tags</label>
                <input
                  id="listing-dietary"
                  type="text"
                  value={dietaryTags}
                  onChange={handleDietaryTagsChange}
                  className={inputClasses}
                />
                <p className="text-xs text-text-muted mt-1">Comma-separated</p>
              </div>
              <div>
                <label htmlFor="listing-allergen" className={labelClasses}>Allergen tags</label>
                <input
                  id="listing-allergen"
                  type="text"
                  value={allergenTags}
                  onChange={handleAllergenTagsChange}
                  className={inputClasses}
                />
                <p className="text-xs text-text-muted mt-1">Comma-separated</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="listing-pickup-start" className={labelClasses}>Pickup start</label>
                <input
                  id="listing-pickup-start"
                  type="datetime-local"
                  required
                  value={pickupStart}
                  onChange={handlePickupStartChange}
                  className={inputClasses}
                />
              </div>
              <div>
                <label htmlFor="listing-pickup-end" className={labelClasses}>Pickup end</label>
                <input
                  id="listing-pickup-end"
                  type="datetime-local"
                  required
                  min={pickupStart}
                  value={pickupEnd}
                  onChange={handlePickupEndChange}
                  className={inputClasses}
                />
              </div>
            </div>
            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full sm:w-auto px-8 py-2.5 text-sm font-semibold text-text-inverse bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm hover:shadow transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </form>
        </>
      )
    }
  } else if (result.status === 404) {
    contentArea = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
        This listing is unavailable.
      </div>
    )
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
    contentArea = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
        {detailMessage}
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-surface rounded-xl border border-border p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-text mb-2">Edit listing</h1>
        {contentArea}
      </div>
    </div>
  )
}

export default EditListingPage
