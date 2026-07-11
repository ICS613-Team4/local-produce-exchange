// API call for creating a listing.

export const listingTimeoutMilliseconds = 3000
export const listingPhotoUploadTimeoutMilliseconds = 30000

export type ListingResult = {
  ok: boolean
  status: number
  data: unknown
  errorMessage: string
}

export type ListingPhotoRef = {
  id: string
  content_type: string
  position: number
}

// The shape of one listing's details the detail page renders. The backend owns
// this shape, so the page reads a successful body with a plain cast to this
// type, the same pattern the other pages use. The two pickup fields and
// created_at are ISO strings exactly as the backend returns them.
export type ListingDetail = {
  id: string
  owner_id: string
  title: string
  description: string
  category: string
  total_quantity: number
  remaining_quantity: number
  dietary_tags: string[]
  allergen_tags: string[]
  pickup_start: string
  pickup_end: string
  status: string
  created_at: string
  // Who deactivated the listing, or null. Set only for an admin takedown; an
  // owner deactivation leaves it null. The my-listings page reads this to show
  // an "administrator deactivated this" note. Optional so the existing pages
  // that read this type (which never send it) keep type-checking.
  deactivated_by?: string | null
  // The owner's display name. Only the GET-details endpoint fills it (the
  // detail page shows "Posted by <name>"); the other listing endpoints send
  // an empty string, so it is optional here for the same reason as above.
  owner_name?: string
  photos?: ListingPhotoRef[]
}

// The shape of the listing fields the page builds and sends. The two pickup
// fields are already timezone-aware ISO strings by the time they reach here.
export type ListingFields = {
  title: string
  description: string
  category: string
  total_quantity: number
  dietary_tags: string[]
  allergen_tags: string[]
  pickup_start: string
  pickup_end: string
}

// The optional search text and filters the browse page sends. Every field is
// optional: a field left out does not narrow the results. dietary_tags and
// allergen_tags are sent as repeated query params, one per selected tag.
export type BrowseListingFilters = {
  q?: string
  category?: string
  dietary_tags?: string[]
  allergen_tags?: string[]
  limit?: number
}

export async function sendCreateListingRequest(
  memberId: string,
  listingFields: ListingFields,
): Promise<ListingResult> {
  // The acting member's id travels in the X-Member-Id header, the same identity
  // path the invite endpoint uses. The page reads the id from localStorage and
  // passes it in, so this function stays a plain function of its inputs.
  try {
    const response = await fetch('/api/listings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Member-Id': memberId,
      },
      body: JSON.stringify(listingFields),
      // Cancel the request if the backend takes too long to answer.
      signal: AbortSignal.timeout(listingTimeoutMilliseconds),
    })

    const responseText = await response.text()
    let data: unknown = ''
    if (responseText !== '') {
      try {
        data = JSON.parse(responseText)
      } catch {
        // If a proxy or server problem returns plain text or HTML, keep the
        // HTTP status and show the body instead of throwing it away.
        data = responseText
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data: data,
      errorMessage: '',
    }
  } catch (caughtError) {
    // Without this catch, a timeout or network failure would print
    // "Uncaught (in promise)" in the console instead of showing on the page.
    let errorMessage: string
    if (caughtError instanceof DOMException && caughtError.name === 'TimeoutError') {
      errorMessage =
        'Timeout: no answer from the backend after ' + listingTimeoutMilliseconds + ' ms.'
    } else {
      errorMessage = 'Request failed: ' + String(caughtError)
    }

    return {
      ok: false,
      status: 0,
      data: '',
      errorMessage: errorMessage,
    }
  }
}

export async function sendUploadListingPhotoRequest(
  listingId: string,
  memberId: string,
  file: File,
): Promise<ListingResult> {
  const formData = new FormData()
  formData.append('file', file)

  try {
    const response = await fetch('/api/listings/' + listingId + '/photos', {
      method: 'POST',
      headers: {
        'X-Member-Id': memberId,
      },
      body: formData,
      signal: AbortSignal.timeout(listingPhotoUploadTimeoutMilliseconds),
    })

    const responseText = await response.text()
    let data: unknown = ''
    if (responseText !== '') {
      try {
        data = JSON.parse(responseText)
      } catch {
        data = responseText
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data: data,
      errorMessage: '',
    }
  } catch (caughtError) {
    let errorMessage: string
    if (caughtError instanceof DOMException && caughtError.name === 'TimeoutError') {
      errorMessage =
        'Timeout: no answer from the backend after ' +
        listingPhotoUploadTimeoutMilliseconds +
        ' ms.'
    } else {
      errorMessage = 'Request failed: ' + String(caughtError)
    }

    return {
      ok: false,
      status: 0,
      data: '',
      errorMessage: errorMessage,
    }
  }
}

export async function sendDeleteListingPhotoRequest(
  listingId: string,
  memberId: string,
  photoId: string,
): Promise<ListingResult> {
  try {
    const response = await fetch(
      '/api/listings/' + listingId + '/photos/' + photoId,
      {
        method: 'DELETE',
        headers: {
          'X-Member-Id': memberId,
        },
        signal: AbortSignal.timeout(listingTimeoutMilliseconds),
      },
    )

    const responseText = await response.text()
    let data: unknown = ''
    if (responseText !== '') {
      try {
        data = JSON.parse(responseText)
      } catch {
        data = responseText
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data: data,
      errorMessage: '',
    }
  } catch (caughtError) {
    let errorMessage: string
    if (caughtError instanceof DOMException && caughtError.name === 'TimeoutError') {
      errorMessage =
        'Timeout: no answer from the backend after ' + listingTimeoutMilliseconds + ' ms.'
    } else {
      errorMessage = 'Request failed: ' + String(caughtError)
    }

    return {
      ok: false,
      status: 0,
      data: '',
      errorMessage: errorMessage,
    }
  }
}

export async function sendUpdateListingRequest(
  listingId: string,
  memberId: string,
  listingFields: ListingFields,
): Promise<ListingResult> {
  // The edit endpoint takes the same full listing body as create, but writes it
  // to an existing row.
  try {
    const response = await fetch('/api/listings/' + listingId, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Member-Id': memberId,
      },
      body: JSON.stringify(listingFields),
      signal: AbortSignal.timeout(listingTimeoutMilliseconds),
    })

    const responseText = await response.text()
    let data: unknown = ''
    if (responseText !== '') {
      try {
        data = JSON.parse(responseText)
      } catch {
        data = responseText
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data: data,
      errorMessage: '',
    }
  } catch (caughtError) {
    let errorMessage: string
    if (caughtError instanceof DOMException && caughtError.name === 'TimeoutError') {
      errorMessage =
        'Timeout: no answer from the backend after ' + listingTimeoutMilliseconds + ' ms.'
    } else {
      errorMessage = 'Request failed: ' + String(caughtError)
    }

    return {
      ok: false,
      status: 0,
      data: '',
      errorMessage: errorMessage,
    }
  }
}

export async function sendDeactivateListingRequest(
  listingId: string,
  memberId: string,
): Promise<ListingResult> {
  // The deactivate endpoint flips the listing's status to "deactivated". It
  // takes no request body: the listing id is in the URL and the acting member
  // rides in the X-Member-Id header. A success answers 204 with an empty body,
  // which the parser below keeps as an empty string, so success is read off
  // result.ok.
  try {
    const response = await fetch('/api/listings/' + listingId + '/deactivate', {
      method: 'POST',
      headers: {
        'X-Member-Id': memberId,
      },
      signal: AbortSignal.timeout(listingTimeoutMilliseconds),
    })

    const responseText = await response.text()
    let data: unknown = ''
    if (responseText !== '') {
      try {
        data = JSON.parse(responseText)
      } catch {
        data = responseText
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data: data,
      errorMessage: '',
    }
  } catch (caughtError) {
    let errorMessage: string
    if (caughtError instanceof DOMException && caughtError.name === 'TimeoutError') {
      errorMessage =
        'Timeout: no answer from the backend after ' + listingTimeoutMilliseconds + ' ms.'
    } else {
      errorMessage = 'Request failed: ' + String(caughtError)
    }

    return {
      ok: false,
      status: 0,
      data: '',
      errorMessage: errorMessage,
    }
  }
}

export async function sendReactivateListingRequest(
  listingId: string,
  memberId: string,
): Promise<ListingResult> {
  // The reactivate endpoint flips an owner-deactivated listing back to active.
  // It takes no request body, and success is a 204 with an empty body.
  try {
    const response = await fetch('/api/listings/' + listingId + '/reactivate', {
      method: 'POST',
      headers: {
        'X-Member-Id': memberId,
      },
      signal: AbortSignal.timeout(listingTimeoutMilliseconds),
    })

    const responseText = await response.text()
    let data: unknown = ''
    if (responseText !== '') {
      try {
        data = JSON.parse(responseText)
      } catch {
        data = responseText
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data: data,
      errorMessage: '',
    }
  } catch (caughtError) {
    let errorMessage: string
    if (caughtError instanceof DOMException && caughtError.name === 'TimeoutError') {
      errorMessage =
        'Timeout: no answer from the backend after ' + listingTimeoutMilliseconds + ' ms.'
    } else {
      errorMessage = 'Request failed: ' + String(caughtError)
    }

    return {
      ok: false,
      status: 0,
      data: '',
      errorMessage: errorMessage,
    }
  }
}

export async function sendBrowseListingsRequest(
  memberId: string,
  filters: BrowseListingFilters,
): Promise<ListingResult> {
  // Build the query string from the chosen filters, leaving out anything empty.
  // Each selected dietary or allergen tag is appended as its own repeated param
  // (dietary_tags=a&dietary_tags=b), which the backend binds back into a list.
  const params = new URLSearchParams()
  if (filters.q !== undefined && filters.q !== '') {
    params.append('q', filters.q)
  }
  if (filters.category !== undefined && filters.category !== '') {
    params.append('category', filters.category)
  }
  if (filters.dietary_tags !== undefined) {
    for (let index = 0; index < filters.dietary_tags.length; index = index + 1) {
      params.append('dietary_tags', filters.dietary_tags[index])
    }
  }
  if (filters.allergen_tags !== undefined) {
    for (let index = 0; index < filters.allergen_tags.length; index = index + 1) {
      params.append('allergen_tags', filters.allergen_tags[index])
    }
  }
  if (filters.limit !== undefined) {
    params.append('limit', String(filters.limit))
  }

  // With no params, ask for the plain /api/listings; otherwise append the query.
  const queryText = params.toString()
  let url = '/api/listings'
  if (queryText !== '') {
    url = '/api/listings?' + queryText
  }

  // The acting member's id travels in the X-Member-Id header, the same identity
  // path the other listing calls use. This is a GET, so there is no body.
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Member-Id': memberId,
      },
      // Cancel the request if the backend takes too long to answer.
      signal: AbortSignal.timeout(listingTimeoutMilliseconds),
    })

    const responseText = await response.text()
    let data: unknown = ''
    if (responseText !== '') {
      try {
        data = JSON.parse(responseText)
      } catch {
        // If a proxy or server problem returns plain text or HTML, keep the
        // HTTP status and show the body instead of throwing it away.
        data = responseText
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data: data,
      errorMessage: '',
    }
  } catch (caughtError) {
    // Without this catch, a timeout or network failure would print
    // "Uncaught (in promise)" in the console instead of showing on the page.
    let errorMessage: string
    if (caughtError instanceof DOMException && caughtError.name === 'TimeoutError') {
      errorMessage =
        'Timeout: no answer from the backend after ' + listingTimeoutMilliseconds + ' ms.'
    } else {
      errorMessage = 'Request failed: ' + String(caughtError)
    }

    return {
      ok: false,
      status: 0,
      data: '',
      errorMessage: errorMessage,
    }
  }
}

export async function sendGetMyListingsRequest(memberId: string): Promise<ListingResult> {
  // The caller's own listings, active and deactivated (US-24). GET
  // /api/my-listings with the member id in the X-Member-Id header, the same
  // identity path the other listing calls use. This is a GET, so there is no
  // request body. The body shape copies sendBrowseListingsRequest, minus the
  // query-string building, since this endpoint takes no filters.
  try {
    const response = await fetch('/api/my-listings', {
      method: 'GET',
      headers: {
        'X-Member-Id': memberId,
      },
      // Cancel the request if the backend takes too long to answer.
      signal: AbortSignal.timeout(listingTimeoutMilliseconds),
    })

    const responseText = await response.text()
    let data: unknown = ''
    if (responseText !== '') {
      try {
        data = JSON.parse(responseText)
      } catch {
        // If a proxy or server problem returns plain text or HTML, keep the
        // HTTP status and show the body instead of throwing it away.
        data = responseText
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data: data,
      errorMessage: '',
    }
  } catch (caughtError) {
    // Without this catch, a timeout or network failure would print
    // "Uncaught (in promise)" in the console instead of showing on the page.
    let errorMessage: string
    if (caughtError instanceof DOMException && caughtError.name === 'TimeoutError') {
      errorMessage =
        'Timeout: no answer from the backend after ' + listingTimeoutMilliseconds + ' ms.'
    } else {
      errorMessage = 'Request failed: ' + String(caughtError)
    }

    return {
      ok: false,
      status: 0,
      data: '',
      errorMessage: errorMessage,
    }
  }
}

export async function sendGetListingRequest(
  listingId: string,
  memberId: string,
): Promise<ListingResult> {
  // The acting member's id travels in the X-Member-Id header, the same identity
  // path the create endpoint uses. The page reads the id from localStorage and
  // passes it in. This is a GET, so there is no request body.
  try {
    const response = await fetch(`/api/listings/${listingId}`, {
      method: 'GET',
      headers: {
        'X-Member-Id': memberId,
      },
      // Cancel the request if the backend takes too long to answer.
      signal: AbortSignal.timeout(listingTimeoutMilliseconds),
    })

    const responseText = await response.text()
    let data: unknown = ''
    if (responseText !== '') {
      try {
        data = JSON.parse(responseText)
      } catch {
        // If a proxy or server problem returns plain text or HTML, keep the
        // HTTP status and show the body instead of throwing it away.
        data = responseText
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data: data,
      errorMessage: '',
    }
  } catch (caughtError) {
    // Without this catch, a timeout or network failure would print
    // "Uncaught (in promise)" in the console instead of showing on the page.
    let errorMessage: string
    if (caughtError instanceof DOMException && caughtError.name === 'TimeoutError') {
      errorMessage =
        'Timeout: no answer from the backend after ' + listingTimeoutMilliseconds + ' ms.'
    } else {
      errorMessage = 'Request failed: ' + String(caughtError)
    }

    return {
      ok: false,
      status: 0,
      data: '',
      errorMessage: errorMessage,
    }
  }
}
