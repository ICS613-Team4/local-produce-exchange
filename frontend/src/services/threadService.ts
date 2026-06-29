// API calls for the exchange thread: read and send messages.

const threadTimeoutMilliseconds = 3000

export type ThreadResult = {
  ok: boolean
  status: number
  data: unknown
  errorMessage: string
}

export type MessageData = {
  id: string
  thread_id: string
  sender_id: string
  sender_name: string
  body: string
  sent_at: string
}

export type ThreadData = {
  id: string
  claim_id: string
  created_at: string
  messages: MessageData[]
}

async function fetchThread(url: string, options: RequestInit): Promise<ThreadResult> {
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(threadTimeoutMilliseconds),
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

    return { ok: response.ok, status: response.status, data, errorMessage: '' }
  } catch (caughtError) {
    let errorMessage: string
    if (caughtError instanceof DOMException && caughtError.name === 'TimeoutError') {
      errorMessage =
        'Timeout: no answer from the backend after ' + threadTimeoutMilliseconds + ' ms.'
    } else {
      errorMessage = 'Request failed: ' + String(caughtError)
    }
    return { ok: false, status: 0, data: '', errorMessage }
  }
}

export async function getThread(memberId: string, claimId: string): Promise<ThreadResult> {
  return fetchThread(`/api/claims/${claimId}/thread`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Member-Id': memberId,
    },
  })
}

export async function sendMessage(
  memberId: string,
  claimId: string,
  body: string,
): Promise<ThreadResult> {
  return fetchThread(`/api/claims/${claimId}/thread/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Member-Id': memberId,
    },
    body: JSON.stringify({ body }),
  })
}
