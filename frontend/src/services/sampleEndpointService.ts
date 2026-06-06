// API calls for the sample endpoint.

export const sampleEndpointTimeoutMilliseconds = 3000

export type SampleEndpointResult = {
  ok: boolean
  status: number
  data: unknown
  errorMessage: string
}

export async function sendSampleEndpointRequest(bodyText: string): Promise<SampleEndpointResult> {
  try {
    const response = await fetch('/api/sample-endpoint', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: bodyText,
      // Cancel the request if the backend takes too long to answer.
      signal: AbortSignal.timeout(sampleEndpointTimeoutMilliseconds),
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
        'Timeout: no answer from the backend after ' + sampleEndpointTimeoutMilliseconds + ' ms.'
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
