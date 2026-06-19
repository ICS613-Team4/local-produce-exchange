// API call for creating a listing.

export const listingTimeoutMilliseconds = 3000

export type ListingResult = {
  ok: boolean
  status: number
  data: unknown
  errorMessage: string
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
