// API calls for the admin audit log (US-35): a chronological view of admin
// moderation actions, and a downloadable PDF of the same.

const adminAuditLogTimeoutMilliseconds = 3000

export type AdminAuditLogResult = {
  ok: boolean
  status: number
  data: unknown
  errorMessage: string
}

export type AdminAuditLogEntry = {
  id: string
  admin_id: string | null
  admin_name: string | null
  action: string
  target_type: string
  target_id: string
  target_label: string | null
  reason: string | null
  created_at: string
}

export type AdminAuditLogResponse = {
  entries: AdminAuditLogEntry[]
  total_count: number
  start_date: string | null
  end_date: string | null
}

function buildQuery(startDate: string, endDate: string): string {
  const params = new URLSearchParams()
  if (startDate !== '') {
    params.append('start_date', startDate)
  }
  if (endDate !== '') {
    params.append('end_date', endDate)
  }
  return params.toString()
}

// startDate/endDate are 'YYYY-MM-DD' strings straight from a date input, or
// '' for "no bound on this end".
export async function getAuditLog(
  actingMemberId: string,
  startDate: string,
  endDate: string,
): Promise<AdminAuditLogResult> {
  const query = buildQuery(startDate, endDate)
  const url = query === '' ? '/api/admin/audit-log' : `/api/admin/audit-log?${query}`

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Member-Id': actingMemberId,
      },
      signal: AbortSignal.timeout(adminAuditLogTimeoutMilliseconds),
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
        'Timeout: no answer from the backend after ' + adminAuditLogTimeoutMilliseconds + ' ms.'
    } else {
      errorMessage = 'Request failed: ' + String(caughtError)
    }
    return { ok: false, status: 0, data: '', errorMessage }
  }
}

export type DownloadAuditLogPdfOutcome = {
  ok: boolean
  status: number
  errorMessage: string
}

// Unlike every other service call in this codebase, the export endpoint
// returns binary PDF, not JSON, so this reads the body as a blob and drives
// a browser download through a temporary anchor rather than returning JSON
// data for a page to render. A plain <a href="/api/..."> does not work here
// (unlike photo serving) because this endpoint is require_admin-gated on the
// X-Member-Id header, which a bare anchor click cannot set.
export async function downloadAuditLogPdf(
  actingMemberId: string,
  startDate: string,
  endDate: string,
): Promise<DownloadAuditLogPdfOutcome> {
  const query = buildQuery(startDate, endDate)
  const url = query === '' ? '/api/admin/audit-log/export' : `/api/admin/audit-log/export?${query}`

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Member-Id': actingMemberId,
      },
      signal: AbortSignal.timeout(adminAuditLogTimeoutMilliseconds),
    })

    if (!response.ok) {
      return { ok: false, status: response.status, errorMessage: '' }
    }

    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = 'audit-log.pdf'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(objectUrl)

    return { ok: true, status: response.status, errorMessage: '' }
  } catch (caughtError) {
    let errorMessage: string
    if (caughtError instanceof DOMException && caughtError.name === 'TimeoutError') {
      errorMessage =
        'Timeout: no answer from the backend after ' + adminAuditLogTimeoutMilliseconds + ' ms.'
    } else {
      errorMessage = 'Request failed: ' + String(caughtError)
    }
    return { ok: false, status: 0, errorMessage }
  }
}
