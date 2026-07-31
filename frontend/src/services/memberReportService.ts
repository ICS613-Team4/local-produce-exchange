// Filing a report against another member (US-37).

export const memberReportTimeoutMilliseconds = 3000

export type MemberReportResult = {
  ok: boolean
  status: number
  data: unknown
  errorMessage: string
}

export async function sendCreateMemberReportRequest(
  actingMemberId: string,
  targetMemberId: string,
  category: string,
  detail: string,
): Promise<MemberReportResult> {
  const url = '/api/members/' + targetMemberId + '/reports'

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Member-Id': actingMemberId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ category: category, detail: detail === '' ? null : detail }),
      signal: AbortSignal.timeout(memberReportTimeoutMilliseconds),
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
        'Timeout: no answer from the backend after ' + memberReportTimeoutMilliseconds + ' ms.'
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
