// API call for creating an invite token.

export const inviteTimeoutMilliseconds = 3000

export type InviteResult = {
  ok: boolean
  status: number
  data: unknown
  errorMessage: string
}

export async function sendCreateInviteRequest(memberId: string): Promise<InviteResult> {
  // The acting member's id travels in the X-Member-Id header, the same identity
  // path the listing endpoint uses. The backend loads that member and checks
  // the account is active. There is no request body.
  try {
    const response = await fetch('/api/invites', {
      method: 'POST',
      headers: {
        'X-Member-Id': memberId,
      },
      // Cancel the request if the backend takes too long to answer.
      signal: AbortSignal.timeout(inviteTimeoutMilliseconds),
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
        'Timeout: no answer from the backend after ' + inviteTimeoutMilliseconds + ' ms.'
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
