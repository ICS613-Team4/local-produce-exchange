import { useState } from 'react'

import { clearStoredLogin } from '../services/authService'
import {
  downloadAuditLogPdf,
  getAuditLog,
  type AdminAuditLogResponse,
  type AdminAuditLogResult,
} from '../services/adminAuditLogService'
import { formatTimestamp } from '../utils/formatTimestamp'

function AdminAuditLogPage() {
  const memberId = window.localStorage.getItem('memberId') ?? ''

  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [hasGenerated, setHasGenerated] = useState(false)
  const [result, setResult] = useState<AdminAuditLogResult | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setResult(null)
    setHasGenerated(true)
    const generatedResult = await getAuditLog(memberId, startDate, endDate)
    if (generatedResult.status === 401) {
      clearStoredLogin()
      return
    }
    setResult(generatedResult)
  }

  async function handleExport() {
    setExporting(true)
    setExportError('')
    const outcome = await downloadAuditLogPdf(memberId, startDate, endDate)
    setExporting(false)
    if (outcome.status === 401) {
      clearStoredLogin()
      return
    }
    if (!outcome.ok) {
      setExportError(outcome.errorMessage || 'Could not export the PDF (HTTP ' + outcome.status + ').')
    }
  }

  const inputClasses = 'w-full px-4 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-150'

  let resultsArea = null
  if (hasGenerated) {
    if (result === null) {
      resultsArea = <p className="text-text-muted text-sm py-8 text-center">Loading&hellip;</p>
    } else if (result.errorMessage !== '') {
      resultsArea = (
        <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
          {result.errorMessage}
        </div>
      )
    } else if (result.ok) {
      const log = result.data as AdminAuditLogResponse

      if (log.entries.length === 0) {
        resultsArea = <p className="text-text-muted text-sm py-8 text-center">No admin actions in this range.</p>
      } else {
        resultsArea = (
          <div className="bg-surface rounded-xl border border-border shadow-sm overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium text-text-muted uppercase tracking-wide">
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Admin</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Target</th>
                  <th className="px-4 py-3">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {log.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-4 py-3 text-text-muted">{formatTimestamp(entry.created_at)}</td>
                    <td className="px-4 py-3 text-text">{entry.admin_name ?? '(unknown)'}</td>
                    <td className="px-4 py-3 text-text capitalize">{entry.action.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-text">{entry.target_label ?? entry.target_type}</td>
                    <td className="px-4 py-3 text-text-muted">{entry.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    } else {
      let detail: unknown = undefined
      if (typeof result.data === 'object' && result.data !== null) {
        detail = (result.data as { detail?: unknown }).detail
      }
      let detailMessage = 'Could not load the audit log (HTTP ' + result.status + ').'
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
      <h1 className="text-3xl font-bold text-text mb-6">Admin audit log</h1>

      <div className="bg-surface rounded-xl border border-border p-6 shadow-sm mb-8">
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="audit-log-start-date" className="block text-sm font-medium text-text mb-1.5">
              Start date (optional)
            </label>
            <input
              id="audit-log-start-date"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className={inputClasses}
            />
          </div>
          <div>
            <label htmlFor="audit-log-end-date" className="block text-sm font-medium text-text mb-1.5">
              End date (optional)
            </label>
            <input
              id="audit-log-end-date"
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
            Load audit log
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={handleExport}
            className="inline-flex items-center px-6 py-2.5 text-sm font-semibold text-text border border-border rounded-lg hover:bg-background-alt transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exporting ? 'Exporting…' : 'Export PDF'}
          </button>
        </form>
        {exportError !== '' && (
          <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error mt-4" role="alert">
            {exportError}
          </div>
        )}
      </div>

      {resultsArea}
    </section>
  )
}

export default AdminAuditLogPage
