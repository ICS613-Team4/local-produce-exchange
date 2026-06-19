import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'

import { sendCreateListingRequest } from '../services/listingService'
import { formatApiResult } from '../utils/formatApiResult'

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

  // Holds the message shown in the error area. Empty means no error.
  const [errorMessage, setErrorMessage] = useState('')

  // Holds the raw backend response after a failed submit, for debugging.
  const [rawResponseText, setRawResponseText] = useState('')

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
      // Tell the dashboard a listing was just created, so it can confirm it
      // even though there is no listing-detail page yet.
      navigate('/dashboard', { state: { created: true } })
      return
    }

    // The request finished without success, so re-enable the button.
    setIsSubmitting(false)

    if (result.errorMessage !== '') {
      // A transport failure: timeout or network error.
      setErrorMessage(result.errorMessage)
      setRawResponseText('')
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
      setErrorMessage('Please check your entries and try again.')
    } else {
      setErrorMessage('Could not create the listing (HTTP ' + result.status + ').')
    }
    setRawResponseText(formatApiResult(result.ok, result.status, result.data))
  }

  // Not logged in: send the visitor to the login page. Returning <Navigate>
  // from render is the correct way; calling navigate() during render warns.
  if (memberId === '') {
    return <Navigate to="/login" replace />
  }

  // Build the error area only when there is an error to show.
  let errorArea = <></>
  if (errorMessage !== '') {
    errorArea = <p role="alert">{errorMessage}</p>
  }

  // After a failed submit, also show the raw backend response.
  let rawResponseArea = <></>
  if (rawResponseText !== '') {
    rawResponseArea = (
      <pre style={{ border: '1px solid black', padding: '10px', whiteSpace: 'pre-wrap' }}>
        {rawResponseText}
      </pre>
    )
  }

  return (
    <>
      <h1>Create a listing</h1>
      <p>
        <Link to="/dashboard">Go to dashboard</Link>
      </p>
      <p>Fill in the details below to post a new listing.</p>
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
          Create listing
        </button>
      </form>
      {errorArea}
      {rawResponseArea}
    </>
  )
}

export default CreateListingPage
