import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'

import {
  sendCreateListingRequest,
  sendUploadListingPhotoRequest,
} from '../services/listingService'

function CreateListingPage() {
  const navigate = useNavigate()

  // There is no server session yet, so the page reads the logged-in member's
  // id from localStorage. An empty value means nobody is logged in here.
  const memberId = window.localStorage.getItem('memberId') ?? ''

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [totalQuantity, setTotalQuantity] = useState('')
  const [dietaryTags, setDietaryTags] = useState('')
  const [allergenTags, setAllergenTags] = useState('')
  const [pickupStart, setPickupStart] = useState('')
  const [pickupEnd, setPickupEnd] = useState('')
  const [selectedPhotos, setSelectedPhotos] = useState<File[]>([])

  // Holds the message shown in the error area. Empty means no error.
  const [errorMessage, setErrorMessage] = useState('')
  const [createdListingId, setCreatedListingId] = useState('')

  // Blocks a second submit while the first request is still in flight, so a
  // fast double-click cannot create two listings.
  const [isSubmitting, setIsSubmitting] = useState(false)

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

  function handlePhotosChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = []
    if (event.target.files !== null) {
      for (let index = 0; index < event.target.files.length; index = index + 1) {
        files.push(event.target.files[index])
      }
    }
    setSelectedPhotos(files)
  }

  // Splits a comma-separated tag string into a trimmed array with no blanks.
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
    setCreatedListingId('')

    // The datetime-local inputs hold a local wall-clock string with no
    // timezone. Convert each to a timezone-aware ISO string so it matches the
    // timestamptz columns and passes the backend's timezone check.
    const pickupStartIso = new Date(pickupStart).toISOString()
    const pickupEndIso = new Date(pickupEnd).toISOString()

    // A number input still hands back a string, so convert before sending.
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

    const result = await sendCreateListingRequest(memberId, listingFields)

    if (result.ok) {
      // Read the new listing's id from the response and open its detail page, so
      // the poster immediately sees the listing they just created. result.data
      // is unknown, so check it is an object with a string id before using it.
      let newListingId = ''
      if (typeof result.data === 'object' && result.data !== null) {
        const dataObject = result.data as { id?: unknown }
        if (typeof dataObject.id === 'string') {
          newListingId = dataObject.id
        }
      }

      if (newListingId !== '') {
        const photoFailures = []
        for (let index = 0; index < selectedPhotos.length; index = index + 1) {
          const photo = selectedPhotos[index]
          const photoResult = await sendUploadListingPhotoRequest(
            newListingId,
            memberId,
            photo,
          )
          if (!photoResult.ok) {
            let reason = photoResult.errorMessage
            if (reason === '' && typeof photoResult.data === 'object' && photoResult.data !== null) {
              const dataObject = photoResult.data as { detail?: unknown }
              if (typeof dataObject.detail === 'string') {
                reason = dataObject.detail
              }
            }
            if (reason === '') {
              reason = 'HTTP ' + photoResult.status
            }
            photoFailures.push(photo.name + ': ' + reason)
          }
        }

        if (photoFailures.length > 0) {
          setCreatedListingId(newListingId)
          setErrorMessage(
            'Your listing was created. Some photos were not added: ' +
              photoFailures.join('; ') +
              '.',
          )
          return
        }

        navigate('/listings/' + newListingId)
        return
      }

      // The listing was created but the response carried no usable id (should
      // not happen on a 201). Do not navigate to the dashboard, which no longer
      // shows any confirmation. Tell the user what happened and leave the submit
      // button disabled, so the already-created listing cannot be duplicated.
      setErrorMessage(
        'The listing was created, but the app could not open its page. Go to the dashboard.',
      )
      return
    }

    // The request finished without success, so re-enable the button.
    setIsSubmitting(false)

    if (result.errorMessage !== '') {
      // A transport failure: timeout or network error.
      setErrorMessage(result.errorMessage)
      return
    }

    // The backend answered with an HTTP error. FastAPI puts the reason in a
    // "detail" field (422 validation, 401 not logged in, 403 suspended).
    let detail: unknown = undefined
    if (typeof result.data === 'object' && result.data !== null) {
      const dataObject = result.data as { detail?: unknown }
      detail = dataObject.detail
    }

    if (typeof detail === 'string') {
      setErrorMessage(detail)
    } else if (Array.isArray(detail)) {
      // A 422 lists one entry per field problem, each with a plain-words "msg".
      // Show those messages instead of a generic line or the raw JSON, joined
      // with a semicolon when more than one field is wrong.
      const fieldMessages = []
      for (let index = 0; index < detail.length; index = index + 1) {
        const entry = detail[index]
        if (typeof entry === 'object' && entry !== null) {
          const entryObject = entry as { msg?: unknown }
          if (typeof entryObject.msg === 'string') {
            fieldMessages.push(entryObject.msg)
          }
        }
      }
      if (fieldMessages.length > 0) {
        setErrorMessage(fieldMessages.join('; '))
      } else {
        setErrorMessage('Please check your entries and try again.')
      }
    } else {
      setErrorMessage('Could not create the listing (HTTP ' + result.status + ').')
    }
  }

  // Not logged in: send the visitor to the login page. Returning <Navigate>
  // from render is the correct way; calling navigate() during render warns.
  if (memberId === '') {
    return <Navigate to="/login" replace />
  }

  // Build the error area only when there is an error to show.
  let errorArea = <></>
  if (errorMessage !== '') {
    errorArea = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error mt-4" role="alert">
        {errorMessage}
        {createdListingId !== '' && (
          <Link
            to={'/listings/' + createdListingId}
            className="block mt-2 font-medium text-primary-700 hover:text-primary-800"
          >
            View your listing
          </Link>
        )}
      </div>
    )
  }

  const inputClasses = 'w-full px-4 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-150'
  // The file input styles its native "Choose File" button through Tailwind's
  // file: variant, so it looks like the site's primary buttons instead of the
  // browser's unstyled default.
  const fileInputClasses = 'w-full p-2 text-sm text-text-muted bg-background border border-border rounded-lg cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-150 file:mr-4 file:px-4 file:py-2 file:rounded-lg file:border-0 file:bg-primary-600 file:text-text-inverse file:text-sm file:font-semibold file:cursor-pointer hover:file:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed'
  const labelClasses = 'block text-sm font-medium text-text mb-1.5'

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-surface rounded-xl border border-border p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-text mb-2">Create a listing</h1>
        <p className="text-sm text-text-muted mb-6">Fill in the details below to post a new listing.</p>
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
              placeholder="e.g. Fresh Tomatoes"
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
              placeholder="Describe what you're sharing…"
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
                placeholder="e.g. Vegetables"
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
                placeholder="vegan, gluten-free"
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
                placeholder="contains nuts"
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
          <div>
            <label htmlFor="listing-photos" className={labelClasses}>Photos (optional)</label>
            <input
              id="listing-photos"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={handlePhotosChange}
              className={fileInputClasses}
            />
            <p className="text-xs text-text-muted mt-1">
              Up to 3 JPEG, PNG, or WebP images. Each image may be up to 2 MB.
            </p>
          </div>
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full sm:w-auto px-8 py-2.5 text-sm font-semibold text-text-inverse bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm hover:shadow transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Creating…' : 'Create listing'}
            </button>
          </div>
        </form>
        {errorArea}
      </div>
    </div>
  )
}

export default CreateListingPage
