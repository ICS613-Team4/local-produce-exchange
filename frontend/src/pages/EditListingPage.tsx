import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'

import { clearStoredLogin } from '../services/authService'
import {
  sendDeleteListingPhotoRequest,
  sendGetListingRequest,
  sendUpdateListingRequest,
  sendUploadListingPhotoRequest,
} from '../services/listingService'
import type { ListingDetail, ListingResult } from '../services/listingService'

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
  const photoActionInFlight = useRef('')
  const photoInputRef = useRef<HTMLInputElement>(null)

  const navigate = useNavigate()
  const params = useParams()
  const listingId = params.id ?? ''

  // The shared nav shows who is logged in, so this page keeps only the name
  // setter, which the 401 paths use to clear a stale session.
  const memberId = window.localStorage.getItem('memberId') ?? ''

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

  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [photoReloadCounter, setPhotoReloadCounter] = useState(0)
  const [isPhotoBusy, setIsPhotoBusy] = useState(false)

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
  }, [listingId, memberId, fillFormFromListing, photoReloadCounter])

  function handleTitleChange(event: React.ChangeEvent<HTMLInputElement>) {
    setTitle(event.target.value)
  }

  function handleDescriptionChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    setDescription(event.target.value)
  }

  function handleCategoryChange(event: React.ChangeEvent<HTMLInputElement>) {
    setCategory(event.target.value)
  }

  function handleTotalQuantityChange(event: React.ChangeEvent<HTMLInputElement>) {
    setTotalQuantity(event.target.value)
  }

  function handleDietaryTagsChange(event: React.ChangeEvent<HTMLInputElement>) {
    setDietaryTags(event.target.value)
  }

  function handleAllergenTagsChange(event: React.ChangeEvent<HTMLInputElement>) {
    setAllergenTags(event.target.value)
  }

  function handlePickupStartChange(event: React.ChangeEvent<HTMLInputElement>) {
    setPickupStart(event.target.value)
  }

  function handlePickupEndChange(event: React.ChangeEvent<HTMLInputElement>) {
    setPickupEnd(event.target.value)
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
      // The save landed in the database, so open the listing's detail page
      // right away. The submit guard stays on while the browser navigates.
      navigate('/listings/' + listingId)
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

  async function handleAddPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    if (photoActionInFlight.current !== '') {
      return
    }
    if (event.target.files === null || event.target.files.length === 0) {
      return
    }

    const file = event.target.files[0]
    photoActionInFlight.current = 'add'
    setIsPhotoBusy(true)
    try {
      const photoResult = await sendUploadListingPhotoRequest(listingId, memberId, file)

      if (photoResult.ok) {
        setPhotoError('')
        if (photoInputRef.current !== null) {
          photoInputRef.current.value = ''
        }
        setPhotoReloadCounter((currentValue) => currentValue + 1)
      } else if (photoResult.status === 401) {
        clearStoredLogin()
      } else if (photoResult.errorMessage !== '') {
        setPhotoError(photoResult.errorMessage)
      } else {
        let detail: unknown = undefined
        if (typeof photoResult.data === 'object' && photoResult.data !== null) {
          const dataObject = photoResult.data as { detail?: unknown }
          detail = dataObject.detail
        }
        if (typeof detail === 'string') {
          setPhotoError(detail)
        } else {
          setPhotoError('Could not add the photo (HTTP ' + photoResult.status + ').')
        }
      }
    } finally {
      photoActionInFlight.current = ''
      setIsPhotoBusy(false)
    }
  }

  async function handleRemovePhoto(photoId: string) {
    if (photoActionInFlight.current !== '') {
      return
    }
    if (!window.confirm('Remove this photo?')) {
      return
    }

    photoActionInFlight.current = photoId
    setIsPhotoBusy(true)
    try {
      const photoResult = await sendDeleteListingPhotoRequest(
        listingId,
        memberId,
        photoId,
      )

      if (photoResult.ok) {
        setPhotoError('')
        setPhotoReloadCounter((currentValue) => currentValue + 1)
      } else if (photoResult.status === 401) {
        clearStoredLogin()
      } else if (photoResult.errorMessage !== '') {
        setPhotoError(photoResult.errorMessage)
      } else {
        let detail: unknown = undefined
        if (typeof photoResult.data === 'object' && photoResult.data !== null) {
          const dataObject = photoResult.data as { detail?: unknown }
          detail = dataObject.detail
        }
        if (typeof detail === 'string') {
          setPhotoError(detail)
        } else {
          setPhotoError('Could not remove the photo (HTTP ' + photoResult.status + ').')
        }
      }
    } finally {
      photoActionInFlight.current = ''
      setIsPhotoBusy(false)
    }
  }

  const inputClasses = 'w-full px-4 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-150'
  // The file input styles its native "Choose File" button through Tailwind's
  // file: variant, so it looks like the site's primary buttons instead of the
  // browser's unstyled default.
  const fileInputClasses = 'w-full p-2 text-sm text-text-muted bg-background border border-border rounded-lg cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-150 file:mr-4 file:px-4 file:py-2 file:rounded-lg file:border-0 file:bg-primary-600 file:text-text-inverse file:text-sm file:font-semibold file:cursor-pointer hover:file:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed'
  const labelClasses = 'block text-sm font-medium text-text mb-1.5'

  let contentArea
  if (result === null || resultListingId !== listingId) {
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
      const photoTiles = []
      if (listing.photos !== undefined) {
        for (let index = 0; index < listing.photos.length; index = index + 1) {
          const photo = listing.photos[index]
          photoTiles.push(
            <div key={photo.id}>
              <img
                src={'/api/photos/' + photo.id}
                alt={'Photo of ' + listing.title}
                loading="lazy"
                className="w-full aspect-square object-cover rounded-lg border border-border"
              />
              <button
                type="button"
                disabled={isPhotoBusy}
                onClick={() => handleRemovePhoto(photo.id)}
                className="mt-2 w-full px-4 py-2 text-sm font-medium text-error bg-error-bg border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Remove
              </button>
            </div>,
          )
        }
      }

      let photoErrorArea = <></>
      if (photoError !== '') {
        photoErrorArea = (
          <div
            className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error mt-4"
            role="alert"
          >
            {photoError}
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
          <section className="mt-8 pt-6 border-t border-border">
            <h2 className="text-lg font-semibold text-text mb-4">Photos</h2>
            {photoTiles.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-5">
                {photoTiles}
              </div>
            )}
            <label htmlFor="listing-photo" className={labelClasses}>Add a photo</label>
            <input
              ref={photoInputRef}
              id="listing-photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={isPhotoBusy}
              onChange={handleAddPhoto}
              className={fileInputClasses}
            />
            <p className="text-xs text-text-muted mt-2">
              To replace a photo, remove it and then add a new one.
            </p>
            {photoErrorArea}
          </section>
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
