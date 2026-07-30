// API calls for the admin side of member reports (US-37): listing them and
// marking one resolved. The member-facing "file a report" call lives in
// memberReportService.ts instead, since that one runs as a regular member,
// not an admin.

const adminMemberReportTimeoutMilliseconds = 3000

export type AdminMemberReportResult = {
  ok: boolean
  status: number
  data: unknown
  errorMessage: string
}

export type MemberReportSummary = {
  id: string
  reporter_id: string
  reporter_name: string
  target_member_id: string
  target_name: string
  category: string
  detail: string | null
  status: string
  created_at: string
  resolved_at: string | null
  resolved_by: string | null
  resolution_note: string | null
}

async function fetchAdminMemberReports(
  url: string,
  actingMemberId: string,
  method: string = 'GET',
  body?: unknown,
): Promise<AdminMemberReportResult> {
  try {
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Member-Id': actingMemberId,
      },
      signal: AbortSignal.timeout(adminMemberReportTimeoutMilliseconds),
    }
    if (body !== undefined) {
      options.body = JSON.stringify(body)
    }
    const response = await fetch(url, options)

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
        'Timeout: no answer from the backend after ' + adminMemberReportTimeoutMilliseconds + ' ms.'
    } else {
      errorMessage = 'Request failed: ' + String(caughtError)
    }
    return { ok: false, status: 0, data: '', errorMessage }
  }
}

export async function listMemberReports(
  actingMemberId: string,
  status: string = 'open',
): Promise<AdminMemberReportResult> {
  const params = new URLSearchParams({ status })
  return fetchAdminMemberReports(`/api/admin/member-reports?${params.toString()}`, actingMemberId)
}

export async function resolveMemberReport(
  reportId: string,
  actingMemberId: string,
  resolutionNote: string,
): Promise<AdminMemberReportResult> {
  const trimmedNote = resolutionNote.trim()
  return fetchAdminMemberReports(
    `/api/admin/member-reports/${reportId}/resolve`,
    actingMemberId,
    'POST',
    { resolution_note: trimmedNote === '' ? null : trimmedNote },
  )
}
