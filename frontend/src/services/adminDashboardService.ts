// API call for the admin landing page snapshot (US-38).

import type { AdminAuditLogEntry } from './adminAuditLogService'
import type { MemberReportSummary } from './adminMemberReportService'

const adminDashboardTimeoutMilliseconds = 3000

export type AdminDashboardResult = {
  ok: boolean
  status: number
  data: unknown
  errorMessage: string
}

export type AdminDashboardSnapshot = {
  generated_at: string
  active_listings: number
  open_requests: number
  members_currently_suspended: number
  open_member_reports_count: number
  recent_member_reports: MemberReportSummary[]
  recent_admin_actions: AdminAuditLogEntry[]
}

export async function getAdminDashboardSnapshot(actingMemberId: string): Promise<AdminDashboardResult> {
  try {
    const response = await fetch('/api/admin/dashboard', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Member-Id': actingMemberId,
      },
      signal: AbortSignal.timeout(adminDashboardTimeoutMilliseconds),
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
        'Timeout: no answer from the backend after ' + adminDashboardTimeoutMilliseconds + ' ms.'
    } else {
      errorMessage = 'Request failed: ' + String(caughtError)
    }
    return { ok: false, status: 0, data: '', errorMessage }
  }
}
