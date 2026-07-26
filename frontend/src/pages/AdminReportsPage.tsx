import { useState } from 'react'

import { clearStoredLogin } from '../services/authService'
import { generateReport, type AdminReport, type AdminReportResult } from '../services/adminReportService'

// One status-breakdown card: a heading, the total, then one row per status
// (even a status with a zero count, since the backend always sends every
// status key - a metric with no activity should still show its full shape,
// not vanish).
function buildBreakdownCard(heading: string, total: number, breakdown: Record<string, number>) {
  const rows = []
  for (const status of Object.keys(breakdown)) {
    rows.push(
      <div key={status} className="flex items-center justify-between py-1.5">
        <span className="text-sm text-text-muted capitalize">{status.replace('_', ' ')}</span>
        <span className="text-sm font-medium text-text">{breakdown[status]}</span>
      </div>,
    )
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-6 shadow-sm">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-base font-semibold text-text">{heading}</h2>
        <span className="text-2xl font-bold text-text">{total}</span>
      </div>
      <div className="divide-y divide-border">{rows}</div>
    </div>
  )
}

function AdminReportsPage() {
  const memberId = window.localStorage.getItem('memberId') ?? ''

  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [hasGenerated, setHasGenerated] = useState(false)
  // Holds the whole response. null means a report is in flight (or none has
  // run yet, guarded separately by hasGenerated).
  const [result, setResult] = useState<AdminReportResult | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setResult(null)
    setHasGenerated(true)
    const generatedResult = await generateReport(memberId, startDate, endDate)
    if (generatedResult.status === 401) {
      // Same convention every protected page follows: clear the stale login
      // and let RequireAdmin's listener take the page away.
      clearStoredLogin()
      return
    }
    setResult(generatedResult)
  }

  const inputClasses = 'w-full px-4 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-150'

  // Build the results area with a plain if/else chain, only once a report has
  // actually been generated (Scenario 1: the admin generates a report; there
  // is nothing to show before that).
  let resultsArea = null
  if (hasGenerated) {
    if (result === null) {
      resultsArea = <p className="text-text-muted text-sm py-8 text-center">Generating&hellip;</p>
    } else if (result.errorMessage !== '') {
      resultsArea = (
        <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
          {result.errorMessage}
        </div>
      )
    } else if (result.ok) {
      const report = result.data as AdminReport

      let rangeNote = 'Covers all activity, with no date range set.'
      if (report.start_date !== null && report.end_date !== null) {
        rangeNote = 'Covers ' + report.start_date + ' through ' + report.end_date + '.'
      } else if (report.start_date !== null) {
        rangeNote = 'Covers ' + report.start_date + ' onward.'
      } else if (report.end_date !== null) {
        rangeNote = 'Covers everything through ' + report.end_date + '.'
      }

      const memberStatusRows = []
      for (const status of Object.keys(report.members_by_status)) {
        memberStatusRows.push(
          <div key={status} className="flex items-center justify-between py-1.5">
            <span className="text-sm text-text-muted capitalize">{status.replace('_', ' ')}</span>
            <span className="text-sm font-medium text-text">{report.members_by_status[status]}</span>
          </div>,
        )
      }

      resultsArea = (
        <div>
          <p className="text-sm text-text-muted mb-4">{rangeNote}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {buildBreakdownCard('Listings', report.total_listings, report.listings_by_status)}
            {buildBreakdownCard('Requests', report.total_requests, report.requests_by_status)}
            <div className="bg-surface rounded-xl border border-border p-6 shadow-sm">
              <div className="flex items-baseline justify-between mb-2">
                <h2 className="text-base font-semibold text-text">Members</h2>
                <span className="text-2xl font-bold text-text">{report.total_members}</span>
              </div>
              <div className="divide-y divide-border">{memberStatusRows}</div>
              {/* Suspension activity (US-25/US-26), from suspension_record:
                  actions taken during the range, not the current status mix
                  above (which is filtered by join date). */}
              <div className="border-t border-border mt-3 pt-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-muted">Suspended in this period</span>
                  <span className="text-sm font-medium text-text">{report.members_suspended}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-muted">Reinstated in this period</span>
                  <span className="text-sm font-medium text-text">{report.members_reinstated}</span>
                </div>
              </div>
            </div>
            <div className="bg-surface rounded-xl border border-border p-6 shadow-sm">
              <div className="flex items-baseline justify-between">
                <h2 className="text-base font-semibold text-text">Completed exchanges</h2>
                <span className="text-2xl font-bold text-text">{report.completed_exchanges}</span>
              </div>
              <p className="text-sm text-text-muted mt-2">
                Counted by when the exchange was completed, not when it was requested.
              </p>
            </div>
          </div>
        </div>
      )
    } else {
      // Scenario 2: a non-admin caller cannot reach this page (RequireAdmin
      // blocks it), but any other HTTP failure (for example a bad date range
      // or a 503) lands here.
      let detail: unknown = undefined
      if (typeof result.data === 'object' && result.data !== null) {
        detail = (result.data as { detail?: unknown }).detail
      }
      let detailMessage = 'Could not generate the report (HTTP ' + result.status + ').'
      if (typeof detail === 'string') {
        detailMessage = detail
      }
      resultsArea = (
        <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
          {detailMessage}
        </div>
      )
    }
  }

  return (
    <section>
      <h1 className="text-3xl font-bold text-text mb-6">Activity report</h1>

      <div className="bg-surface rounded-xl border border-border p-6 shadow-sm mb-8">
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="report-start-date" className="block text-sm font-medium text-text mb-1.5">
              Start date (optional)
            </label>
            <input
              id="report-start-date"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className={inputClasses}
            />
          </div>
          <div>
            <label htmlFor="report-end-date" className="block text-sm font-medium text-text mb-1.5">
              End date (optional)
            </label>
            <input
              id="report-end-date"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className={inputClasses}
            />
          </div>
          <button
            type="submit"
            className="inline-flex items-center px-6 py-2.5 text-sm font-semibold text-text-inverse bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm transition-all duration-150"
          >
            Generate report
          </button>
        </form>
      </div>

      {resultsArea}
    </section>
  )
}

export default AdminReportsPage
