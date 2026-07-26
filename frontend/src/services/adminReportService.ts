// API call for the admin basic activity report (US-28).

const adminReportTimeoutMilliseconds = 3000

export type AdminReportResult = {
  ok: boolean
  status: number
  data: unknown
  errorMessage: string
}

export type AdminReport = {
  start_date: string | null
  end_date: string | null
  generated_at: string
  listings_by_status: Record<string, number>
  total_listings: number
  requests_by_status: Record<string, number>
  total_requests: number
  completed_exchanges: number
  members_by_status: Record<string, number>
  total_members: number
  members_suspended: number
  members_reinstated: number
}

// startDate/endDate are 'YYYY-MM-DD' strings straight from a date input, or
// '' for "no bound on this end". The backend takes the same optional pair.
export async function generateReport(
  actingMemberId: string,
  startDate: string,
  endDate: string,
): Promise<AdminReportResult> {
  const params = new URLSearchParams()
  if (startDate !== '') {
    params.append('start_date', startDate)
  }
  if (endDate !== '') {
    params.append('end_date', endDate)
  }
  const query = params.toString()
  const url = query === '' ? '/api/admin/reports' : `/api/admin/reports?${query}`

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Member-Id': actingMemberId,
      },
      signal: AbortSignal.timeout(adminReportTimeoutMilliseconds),
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
        'Timeout: no answer from the backend after ' + adminReportTimeoutMilliseconds + ' ms.'
    } else {
      errorMessage = 'Request failed: ' + String(caughtError)
    }
    return { ok: false, status: 0, data: '', errorMessage }
  }
}
