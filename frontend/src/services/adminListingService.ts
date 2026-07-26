export const adminListingTimeoutMilliseconds = 3000

export type AdminListingSummary = {
  id: string
  owner_id: string
  owner_name: string
  title: string
  status: string
  deactivated_by: string | null
}

export type AdminListingResult = {
  ok: boolean
  status: number
  data: unknown
  errorMessage: string
}

async function sendAdminListingRequest(
  url: string,
  memberId: string,
  method: 'GET' | 'POST',
): Promise<AdminListingResult> {
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'X-Member-Id': memberId,
      },
      signal: AbortSignal.timeout(adminListingTimeoutMilliseconds),
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
      data,
      errorMessage: '',
    }
  } catch (caughtError) {
    let errorMessage = 'Request failed: ' + String(caughtError)
    if (caughtError instanceof DOMException && caughtError.name === 'TimeoutError') {
      errorMessage =
        'Timeout: no answer from the backend after ' +
        adminListingTimeoutMilliseconds +
        ' ms.'
    }
    return {
      ok: false,
      status: 0,
      data: '',
      errorMessage,
    }
  }
}

export function getAdminListings(memberId: string): Promise<AdminListingResult> {
  return sendAdminListingRequest('/api/admin/listings', memberId, 'GET')
}

export function updateAdminListingStatus(
  listingId: string,
  memberId: string,
  action: 'deactivate' | 'reactivate',
): Promise<AdminListingResult> {
  return sendAdminListingRequest(
    '/api/admin/listings/' + listingId + '/' + action,
    memberId,
    'POST',
  )
}
