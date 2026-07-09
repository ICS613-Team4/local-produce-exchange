import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import {
  getMemberProfile,
  updateMemberProfile,
  type MemberData,
  type ProfileUpdatePayload,
} from '../services/memberService'
import { formatApiResult } from '../utils/formatApiResult'

// Returns true when the logged-in member is the owner of this profile.
// Used to gate the edit button (frontend coverage) and to validate before
// sending a PATCH. The backend enforces the same rule via X-Member-Id.
function isOwnProfile(profileId: string): boolean {
  return window.localStorage.getItem('memberId') === profileId
}

function ProfilePage() {
  const memberId = window.localStorage.getItem('memberId')

  const [member, setMember] = useState<MemberData | null>(null)
  // Only load when there is a memberId to fetch; no memberId means nothing to load.
  const [loading, setLoading] = useState(memberId !== null)
  const [pageError, setPageError] = useState('')

  const [editing, setEditing] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [contactPreference, setContactPreference] = useState('')
  const [neighborhood, setNeighborhood] = useState('')

  const [saveError, setSaveError] = useState('')
  const [rawResponseText, setRawResponseText] = useState('')

  useEffect(() => {
    if (memberId === null) {
      return
    }

    getMemberProfile(memberId).then((result) => {
      setLoading(false)
      if (result.ok) {
        setMember(result.data as MemberData)
      } else {
        setPageError('Could not load your profile.')
      }
    })
  }, [memberId])

  function handleEditClick() {
    if (member === null) return
    setDisplayName(member.profile?.display_name ?? '')
    setContactPreference(member.profile?.contact_preference ?? '')
    setNeighborhood(member.profile?.neighborhood ?? '')
    setSaveError('')
    setRawResponseText('')
    setEditing(true)
  }

  function handleCancelClick() {
    setEditing(false)
    setSaveError('')
    setRawResponseText('')
  }

  async function handleSaveSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (memberId === null || member === null) return

    // Frontend auth check: confirm this is still the member's own profile
    // before sending the request. The backend enforces the same rule.
    if (!isOwnProfile(member.id)) {
      setSaveError('You can only edit your own profile.')
      return
    }

    const trimmedDisplayName = displayName.trim()
    if (trimmedDisplayName === '') {
      setSaveError('Display name must not be blank.')
      return
    }

    const payload: ProfileUpdatePayload = { display_name: trimmedDisplayName }

    if (contactPreference !== '') {
      payload.contact_preference = contactPreference
    }

    const trimmedNeighborhood = neighborhood.trim()
    if (trimmedNeighborhood !== '') {
      payload.neighborhood = trimmedNeighborhood
    }

    const result = await updateMemberProfile(memberId, payload)

    if (result.ok) {
      setMember(result.data as MemberData)
      setEditing(false)
      setSaveError('')
      setRawResponseText('')
      return
    }

    if (result.errorMessage !== '') {
      setSaveError(result.errorMessage)
      setRawResponseText('')
      return
    }

    let detail: unknown = undefined
    if (typeof result.data === 'object' && result.data !== null) {
      detail = (result.data as { detail?: unknown }).detail
    }

    if (typeof detail === 'string') {
      setSaveError(detail)
    } else if (Array.isArray(detail)) {
      setSaveError('Please check your entries and try again.')
    } else {
      setSaveError('Save failed (HTTP ' + result.status + ').')
    }
    setRawResponseText(formatApiResult(result.ok, result.status, result.data))
  }

  const inputClasses = 'w-full px-4 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-150'
  const labelClasses = 'block text-sm font-medium text-text mb-1.5'

  if (memberId === null) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-surface rounded-xl border border-border p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-text mb-4">Profile</h1>
          <p className="text-text-muted">
            Please <Link to="/login" className="font-medium text-primary-600 hover:text-primary-700">log in</Link> to view your profile.
          </p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-surface rounded-xl border border-border p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-text mb-4">Profile</h1>
          <p className="text-text-muted">Loading&hellip;</p>
        </div>
      </div>
    )
  }

  if (pageError !== '') {
    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-surface rounded-xl border border-border p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-text mb-4">Profile</h1>
          <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
            {pageError}
          </div>
        </div>
      </div>
    )
  }

  if (member === null) return null

  const canEdit = isOwnProfile(member.id)

  if (editing && canEdit) {
    const errorArea =
      saveError !== '' ? (
        <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error mt-4" role="alert">
          {saveError}
        </div>
      ) : <></>

    const rawResponseArea =
      rawResponseText !== '' ? (
        <pre className="mt-4 text-xs font-mono bg-background border border-border rounded-lg px-4 py-3 whitespace-pre-wrap text-text-muted">
          {rawResponseText}
        </pre>
      ) : <></>

    return (
      <div className="max-w-lg mx-auto">
        <div className="bg-surface rounded-xl border border-border p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-text mb-6">Edit Profile</h1>
          <form onSubmit={handleSaveSubmit} className="space-y-5">
            <div>
              <label htmlFor="profile-display-name" className={labelClasses}>Display name</label>
              <input
                id="profile-display-name"
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={inputClasses}
              />
            </div>
            <div>
              <label htmlFor="profile-contact-preference" className={labelClasses}>Contact preference</label>
              <select
                id="profile-contact-preference"
                value={contactPreference}
                onChange={(e) => setContactPreference(e.target.value)}
                className={inputClasses}
              >
                <option value="">— choose —</option>
                <option value="email">Email</option>
                <option value="message">Message</option>
                <option value="either">Either</option>
              </select>
            </div>
            <div>
              <label htmlFor="profile-neighborhood" className={labelClasses}>Neighborhood</label>
              <input
                id="profile-neighborhood"
                type="text"
                value={neighborhood}
                onChange={(e) => setNeighborhood(e.target.value)}
                className={inputClasses}
              />
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                className="px-6 py-2.5 text-sm font-semibold text-text-inverse bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm transition-all duration-150"
              >
                Save
              </button>
              <button
                type="button"
                onClick={handleCancelClick}
                className="px-6 py-2.5 text-sm font-medium text-text-muted border border-border rounded-lg hover:bg-background-alt transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
          {errorArea}
          {rawResponseArea}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-surface rounded-xl border border-border p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-text mb-6">Profile</h1>
        <dl className="space-y-4">
          <div>
            <dt className="text-xs font-medium text-text-muted uppercase tracking-wide">Name</dt>
            <dd className="mt-1 text-sm text-text">{member.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-text-muted uppercase tracking-wide">Email</dt>
            <dd className="mt-1 text-sm text-text">{member.email}</dd>
          </div>
          <div className="border-t border-border pt-4">
            <dt className="text-xs font-medium text-text-muted uppercase tracking-wide">Display name</dt>
            <dd className="mt-1 text-sm text-text">{member.profile?.display_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-text-muted uppercase tracking-wide">Contact preference</dt>
            <dd className="mt-1 text-sm text-text">{member.profile?.contact_preference ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-text-muted uppercase tracking-wide">Neighborhood</dt>
            <dd className="mt-1 text-sm text-text">{member.profile?.neighborhood ?? '—'}</dd>
          </div>
          <div className="border-t border-border pt-4">
            <dt className="text-xs font-medium text-text-muted uppercase tracking-wide">Member since</dt>
            <dd className="mt-1 text-sm text-text">{new Date(member.created_at).toLocaleDateString()}</dd>
          </div>
        </dl>
        {canEdit && (
          <button
            onClick={handleEditClick}
            className="mt-6 inline-flex items-center px-6 py-2.5 text-sm font-semibold text-text-inverse bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm transition-all duration-150"
          >
            Edit profile
          </button>
        )}
      </div>
    </div>
  )
}

export default ProfilePage
