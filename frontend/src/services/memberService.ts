// API calls for member profile: view and update.

const memberTimeoutMilliseconds = 3000

export type MemberResult = {
  ok: boolean
  status: number
  data: unknown
  errorMessage: string
}

export type MemberProfile = {
  display_name: string | null
  contact_preference: string | null
  neighborhood: string | null
}

export type MemberData = {
  id: string
  name: string
  email: string
  status: string
  role: string
  created_at: string
  profile: MemberProfile | null
}

export type ProfileUpdatePayload = {
  display_name?: string
  contact_preference?: string
  neighborhood?: string
}

async function fetchMember(url: string, options: RequestInit): Promise<MemberResult> {
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(memberTimeoutMilliseconds),
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
        'Timeout: no answer from the backend after ' + memberTimeoutMilliseconds + ' ms.'
    } else {
      errorMessage = 'Request failed: ' + String(caughtError)
    }
    return { ok: false, status: 0, data: '', errorMessage }
  }
}

export async function getMemberProfile(memberId: string): Promise<MemberResult> {
  return fetchMember(`/api/members/${memberId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Member-Id': memberId,
    },
  })
}

// Loads any member's profile (US-08: view another member's public profile).
// Unlike getMemberProfile, the id in the URL (the profile being viewed) and
// the id in the X-Member-Id header (the logged-in viewer making the request)
// can differ, since a member can view someone else's profile.
export async function getPublicMemberProfile(
  targetMemberId: string,
  actingMemberId: string,
): Promise<MemberResult> {
  return fetchMember(`/api/members/${targetMemberId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Member-Id': actingMemberId,
    },
  })
}

export async function updateMemberProfile(
  memberId: string,
  payload: ProfileUpdatePayload,
): Promise<MemberResult> {
  return fetchMember(`/api/members/${memberId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      // The backend resolves this header to the acting member and checks that
      // member's id matches the profile being edited.
      // Replace with an Authorization: Bearer token when JWT login lands.
      'X-Member-Id': memberId,
    },
    body: JSON.stringify(payload),
  })
}
