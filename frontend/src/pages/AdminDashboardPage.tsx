import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'

import { clearStoredLogin } from '../services/authService'
import {
  getAdminDashboardSnapshot,
  type AdminDashboardResult,
  type AdminDashboardSnapshot,
} from '../services/adminDashboardService'
import { resolveMemberReport, type MemberReportSummary } from '../services/adminMemberReportService'
import { formatTimestamp } from '../utils/formatTimestamp'

function resultMessage(result: AdminDashboardResult, fallback: string): string {
  if (result.errorMessage !== '') {
    return result.errorMessage
  }
  if (typeof result.data === 'object' && result.data !== null) {
    const detail = (result.data as { detail?: unknown }).detail
    if (typeof detail === 'string') {
      return detail
    }
  }
  return fallback
}

// One stat tile: a label and a number, following AdminReportsPage's
// buildBreakdownCard convention (a free function returning JSX, not a
// separate shared component, since this shape is only used here).
function buildStatTile(label: string, value: number) {
  return (
    <div key={label} className="bg-surface rounded-xl border border-border p-6 shadow-sm">
      <p className="text-sm text-text-muted">{label}</p>
      <p className="text-3xl font-bold text-text mt-1">{value}</p>
    </div>
  )
}

function AdminDashboardPage() {
  const memberId = window.localStorage.getItem('memberId') ?? ''

  const [snapshot, setSnapshot] = useState<AdminDashboardSnapshot | null>(null)
  const [loadError, setLoadError] = useState('')

  // The reports panel keeps its own local list, seeded from the snapshot but
  // updated in place on resolve, the same immutable-update-instead-of-refetch
  // pattern AdminListingsPage uses.
  const [reports, setReports] = useState<MemberReportSummary[] | null>(null)
  const [resolveError, setResolveError] = useState('')
  const [resolvingReportId, setResolvingReportId] = useState('')
  const resolveInFlight = useRef('')

  useEffect(() => {
    let cancelled = false

    async function loadSnapshot() {
      const result = await getAdminDashboardSnapshot(memberId)
      if (cancelled) {
        return
      }
      if (result.status === 401) {
        clearStoredLogin()
        return
      }
      if (!result.ok) {
        setLoadError(resultMessage(result, 'Could not load the admin dashboard.'))
        return
      }
      const data = result.data as AdminDashboardSnapshot
      setSnapshot(data)
      setReports(data.recent_member_reports)
    }

    loadSnapshot()
    return () => {
      cancelled = true
    }
  }, [memberId])

  async function handleResolveReport(report: MemberReportSummary) {
    if (resolveInFlight.current !== '') {
      return
    }
    const confirmed = window.confirm('Mark this report resolved?')
    if (!confirmed) {
      return
    }

    resolveInFlight.current = report.id
    setResolvingReportId(report.id)
    setResolveError('')
    const result = await resolveMemberReport(report.id, memberId, '')
    resolveInFlight.current = ''
    setResolvingReportId('')

    if (result.status === 401) {
      clearStoredLogin()
      return
    }
    if (!result.ok) {
      setResolveError(resultMessage(result, 'Could not resolve this report.'))
      return
    }

    setReports((currentReports) => {
      if (currentReports === null) {
        return currentReports
      }
      return currentReports.filter((currentReport) => currentReport.id !== report.id)
    })
    setSnapshot((currentSnapshot) => {
      if (currentSnapshot === null) {
        return currentSnapshot
      }
      return {
        ...currentSnapshot,
        open_member_reports_count: currentSnapshot.open_member_reports_count - 1,
      }
    })
  }

  const cardClasses =
    'bg-surface rounded-xl border border-border p-6 shadow-sm hover:shadow-md hover:border-primary-200 transition-all duration-200 group'
  const cardIconClasses = 'text-3xl mb-3 group-hover:scale-110 transition-transform inline-block'
  const cardTitleClasses = 'text-base font-semibold text-text mb-2 group-hover:text-primary-600'

  let snapshotArea: React.ReactNode
  if (loadError !== '') {
    snapshotArea = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error mb-8" role="alert">
        {loadError}
      </div>
    )
  } else if (snapshot === null) {
    snapshotArea = <p className="text-text-muted text-sm py-8 text-center">Loading&hellip;</p>
  } else {
    let reportRows = null
    if (reports !== null && reports.length > 0) {
      reportRows = reports.map((report) => (
        <div key={report.id} className="flex items-start justify-between gap-4 py-3 border-b border-border last:border-b-0">
          <div>
            <p className="text-sm text-text">
              <span className="font-medium">{report.reporter_name}</span> reported{' '}
              <span className="font-medium">{report.target_name}</span> for{' '}
              <span className="capitalize">{report.category.replace(/_/g, ' ')}</span>
            </p>
            {report.detail !== null && <p className="text-sm text-text-muted mt-1">{report.detail}</p>}
            <p className="text-xs text-text-muted mt-1">{formatTimestamp(report.created_at)}</p>
          </div>
          <button
            type="button"
            disabled={resolvingReportId === report.id}
            onClick={() => handleResolveReport(report)}
            className="shrink-0 px-4 py-2 text-sm font-medium text-text border border-border rounded-lg hover:bg-background-alt transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {resolvingReportId === report.id ? 'Resolving…' : 'Resolve'}
          </button>
        </div>
      ))
    }

    let reportsPanelBody
    if (reports === null || reports.length === 0) {
      reportsPanelBody = <p className="text-sm text-text-muted py-4">No open reports.</p>
    } else {
      reportsPanelBody = <div>{reportRows}</div>
    }

    let recentActionsBody
    if (snapshot.recent_admin_actions.length === 0) {
      recentActionsBody = <p className="text-sm text-text-muted py-4">No recent admin actions.</p>
    } else {
      recentActionsBody = (
        <div>
          {snapshot.recent_admin_actions.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
              <span className="text-sm text-text capitalize">{entry.action.replace(/_/g, ' ')}</span>
              <span className="text-xs text-text-muted">{formatTimestamp(entry.created_at)}</span>
            </div>
          ))}
        </div>
      )
    }

    snapshotArea = (
      <div className="mb-8">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
          {buildStatTile('Active listings', snapshot.active_listings)}
          {buildStatTile('Open requests', snapshot.open_requests)}
          {buildStatTile('Currently suspended members', snapshot.members_currently_suspended)}
          {buildStatTile('Open member reports', snapshot.open_member_reports_count)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-surface rounded-xl border border-border p-6 shadow-sm">
            <h2 className="text-base font-semibold text-text mb-2">Open member reports</h2>
            {resolveError !== '' && (
              <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error mb-3" role="alert">
                {resolveError}
              </div>
            )}
            {reportsPanelBody}
          </div>
          <div className="bg-surface rounded-xl border border-border p-6 shadow-sm">
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="text-base font-semibold text-text">Recent admin actions</h2>
              <Link to="/admin/audit-log" className="text-sm font-semibold text-primary-600 hover:text-primary-700">
                View full audit log →
              </Link>
            </div>
            {recentActionsBody}
          </div>
        </div>
      </div>
    )
  }

  return (
    <section>
      <h1 className="text-3xl font-bold text-text mb-6">Admin Dashboard</h1>

      {snapshotArea}

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-6">
        <Link to="/admin/members" className={cardClasses}>
          <div aria-hidden="true" className={cardIconClasses}>👤</div>
          <h2 className={cardTitleClasses}>Manage Members</h2>
          <p className="text-sm text-text-muted">
            Search members, view full account details, and suspend or reinstate accounts.
          </p>
        </Link>
        <Link to="/admin/listings" className={cardClasses}>
          <div aria-hidden="true" className={cardIconClasses}>🥬</div>
          <h2 className={cardTitleClasses}>Manage Listings</h2>
          <p className="text-sm text-text-muted">
            Review every listing and deactivate or reactivate one.
          </p>
        </Link>
        <Link to="/admin/reports" className={cardClasses}>
          <div aria-hidden="true" className={cardIconClasses}>📊</div>
          <h2 className={cardTitleClasses}>Activity Report</h2>
          <p className="text-sm text-text-muted">
            Generate a basic report of listings, requests, members, and completed exchanges.
          </p>
        </Link>
        <Link to="/admin/audit-log" className={cardClasses}>
          <div aria-hidden="true" className={cardIconClasses}>📋</div>
          <h2 className={cardTitleClasses}>Audit Log</h2>
          <p className="text-sm text-text-muted">
            See every admin action, chronologically, and export it as a PDF.
          </p>
        </Link>
      </div>
    </section>
  )
}

export default AdminDashboardPage
