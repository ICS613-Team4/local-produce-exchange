import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'

import { clearStoredLogin } from '../services/authService'
import { getPublicMemberProfile, type MemberData } from '../services/memberService'
import { sendCreateMemberReportRequest } from '../services/memberReportService'

const REPORT_DETAIL_MAX_LENGTH = 1000

// The fixed category list the backend enforces (MEMBER_REPORT_CATEGORIES in
// routers/member_report.py). Keep the values in sync with that constant.
const REPORT_CATEGORIES = [
  { value: 'harassment', label: 'Harassment' },
  { value: 'no_show', label: 'No-show' },
  { value: 'scam_fraud', label: 'Scam or fraud' },
  { value: 'other', label: 'Other' },
]

function ReportMemberPage() {
  const location = useLocation()
  const targetMemberId = new URLSearchParams(location.search).get('member') ?? ''
  const memberId = window.localStorage.getItem('memberId') ?? ''

  const [target, setTarget] = useState<MemberData | null>(null)
  const [loadError, setLoadError] = useState('')

  const [category, setCategory] = useState('')
  const [detail, setDetail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    if (targetMemberId === '') {
      return
    }
    getPublicMemberProfile(targetMemberId, memberId).then((result) => {
      if (result.status === 401) {
        clearStoredLogin()
        return
      }
      if (result.ok) {
        setTarget(result.data as MemberData)
      } else {
        setLoadError('Could not load this member.')
      }
    })
  }, [memberId, targetMemberId])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (category === '' || submitting) {
      return
    }

    setSubmitting(true)
    setSubmitError('')

    const result = await sendCreateMemberReportRequest(memberId, targetMemberId, category, detail)

    setSubmitting(false)

    if (result.status === 401) {
      clearStoredLogin()
      return
    }
    if (result.errorMessage !== '') {
      setSubmitError(result.errorMessage)
      return
    }
    if (result.ok) {
      setSubmitted(true)
      return
    }

    let message = 'Could not file this report. Please try again.'
    if (typeof result.data === 'object' && result.data !== null) {
      const d = result.data as { detail?: unknown }
      if (typeof d.detail === 'string') {
        message = d.detail
      }
    }
    setSubmitError(message)
  }

  let targetName = 'this member'
  if (target !== null) {
    targetName = target.profile?.display_name ?? target.name
  }

  if (targetMemberId === '') {
    return (
      <div className="max-w-lg mx-auto">
        <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
          No member specified.
        </div>
      </div>
    )
  }

  if (loadError !== '') {
    return (
      <div className="max-w-lg mx-auto">
        <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
          {loadError}
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-surface rounded-xl border border-border p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-text mb-4">Report Submitted</h1>
          <p role="status" className="text-sm text-text">
            Thanks. An administrator will review this report.
          </p>
          <p className="mt-4">
            <Link to={'/profile/' + targetMemberId} className="text-sm font-semibold text-primary-600 hover:text-primary-700">
              Back to profile
            </Link>
          </p>
        </div>
      </div>
    )
  }

  const inputClasses =
    'w-full px-4 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-150'
  const labelClasses = 'block text-sm font-medium text-text mb-1.5'

  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-surface rounded-xl border border-border p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-text mb-2">Report {targetName}</h1>
        <p className="text-sm text-text-muted mb-6">
          This queues the report for an administrator to review. It does not change {targetName}'s
          account on its own.
        </p>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="report-category" className={labelClasses}>
              Reason
            </label>
            <select
              id="report-category"
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputClasses}
            >
              <option value="">— choose —</option>
              {REPORT_CATEGORIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="report-detail" className={labelClasses}>
              Additional detail (optional)
            </label>
            <textarea
              id="report-detail"
              rows={4}
              maxLength={REPORT_DETAIL_MAX_LENGTH}
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              disabled={submitting}
              className={inputClasses + ' resize-y disabled:opacity-50 disabled:cursor-not-allowed'}
            />
            <p className="text-xs text-text-muted mt-2">
              Up to {REPORT_DETAIL_MAX_LENGTH} characters. Leaving it blank is fine.
            </p>
          </div>
          {submitError !== '' && (
            <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
              {submitError}
            </div>
          )}
          <button
            type="submit"
            disabled={category === '' || submitting}
            className="px-6 py-2.5 text-sm font-semibold text-text-inverse bg-error rounded-lg hover:opacity-90 shadow-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Submitting…' : 'Submit Report'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default ReportMemberPage
