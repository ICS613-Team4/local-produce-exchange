// API calls for the admin member search and detail views (US-29), and the
// suspend/unsuspend actions (US-25, US-26).

const adminMemberTimeoutMilliseconds = 3000

export type AdminMemberResult = {
  ok: boolean
  status: number
  data: unknown
  errorMessage: string
}

export type AdminMemberSummary = {
  id: string
  name: string
  email: string
  status: string
}

export type AdminMemberDetail = {
  id: string
  name: string
  email: string
  status: string
  role: string
  created_at: string
  suspended_at: string | null
  display_name: string | null
  neighborhood: string | null
  contact_preference: string | null
}

async function fetchAdminMembers(
  url: string,
  actingMemberId: string,
  method: string = 'GET',
  body?: unknown,
): Promise<AdminMemberResult> {
  try {
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Member-Id': actingMemberId,
      },
      signal: AbortSignal.timeout(adminMemberTimeoutMilliseconds),
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
        'Timeout: no answer from the backend after ' + adminMemberTimeoutMilliseconds + ' ms.'
    } else {
      errorMessage = 'Request failed: ' + String(caughtError)
    }
    return { ok: false, status: 0, data: '', errorMessage }
  }
}

export async function searchMembers(query: string, actingMemberId: string): Promise<AdminMemberResult> {
  const params = new URLSearchParams({ q: query })
  return fetchAdminMembers(`/api/admin/members?${params.toString()}`, actingMemberId)
}

export async function getAdminMemberDetail(
  targetMemberId: string,
  actingMemberId: string,
): Promise<AdminMemberResult> {
  return fetchAdminMembers(`/api/admin/members/${targetMemberId}`, actingMemberId)
}

// US-25: reason is optional, so callers can pass '' for "no reason given"
// without needing an extra undefined/empty branch of their own; this sends
// null in that case so the backend stores no reason rather than an empty
// string.
export async function suspendMember(
  targetMemberId: string,
  actingMemberId: string,
  reason: string,
): Promise<AdminMemberResult> {
  const trimmedReason = reason.trim()
  return fetchAdminMembers(
    `/api/admin/members/${targetMemberId}/suspend`,
    actingMemberId,
    'POST',
    { reason: trimmedReason === '' ? null : trimmedReason },
  )
}

// US-26.
export async function unsuspendMember(
  targetMemberId: string,
  actingMemberId: string,
): Promise<AdminMemberResult> {
  return fetchAdminMembers(`/api/admin/members/${targetMemberId}/unsuspend`, actingMemberId, 'POST')
}
