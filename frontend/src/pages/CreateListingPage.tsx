import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router'

import { sendCreateListingRequest } from '../services/listingService'

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
    errorArea = <p role="alert">{errorMessage}</p>
  }

  return (
    <section>
      <h1>Create a listing</h1>
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
    </section>
  )
}

export default CreateListingPage
