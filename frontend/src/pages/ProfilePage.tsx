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

  if (memberId === null) {
    return (
      <section>
        <h1>Profile</h1>
        <p>
          Please <Link to="/login">log in</Link> to view your profile.
        </p>
      </section>
    )
  }

  if (loading) {
    return (
      <section>
        <h1>Profile</h1>
        <p>Loading&hellip;</p>
      </section>
    )
  }

  if (pageError !== '') {
    return (
      <section>
        <h1>Profile</h1>
        <p role="alert">{pageError}</p>
      </section>
    )
  }

  if (member === null) return null

  const canEdit = isOwnProfile(member.id)

  if (editing && canEdit) {
    const errorArea =
      saveError !== '' ? <p role="alert">{saveError}</p> : <></>

    const rawResponseArea =
      rawResponseText !== '' ? (
        <pre style={{ border: '1px solid black', padding: '10px', whiteSpace: 'pre-wrap' }}>
          {rawResponseText}
        </pre>
      ) : (
        <></>
      )

    return (
      <section>
        <h1>Edit Profile</h1>
        <form onSubmit={handleSaveSubmit}>
          <p>
            <label htmlFor="profile-display-name">Display name</label>{' '}
            <input
              id="profile-display-name"
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </p>
          <p>
            <label htmlFor="profile-contact-preference">Contact preference</label>{' '}
            <select
              id="profile-contact-preference"
              value={contactPreference}
              onChange={(e) => setContactPreference(e.target.value)}
            >
              <option value="">— choose —</option>
              <option value="email">Email</option>
              <option value="message">Message</option>
              <option value="either">Either</option>
            </select>
          </p>
          <p>
            <label htmlFor="profile-neighborhood">Neighborhood</label>{' '}
            <input
              id="profile-neighborhood"
              type="text"
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
            />
          </p>
          <p>
            <button type="submit">Save</button>{' '}
            <button type="button" onClick={handleCancelClick}>
              Cancel
            </button>
          </p>
        </form>
        {errorArea}
        {rawResponseArea}
      </section>
    )
  }

  return (
    <section>
      <h1>Profile</h1>
      <p>
        <strong>Name:</strong> {member.name}
      </p>
      <p>
        <strong>Email:</strong> {member.email}
      </p>
      <p>
        <strong>Display name:</strong> {member.profile?.display_name ?? '—'}
      </p>
      <p>
        <strong>Contact preference:</strong> {member.profile?.contact_preference ?? '—'}
      </p>
      <p>
        <strong>Neighborhood:</strong> {member.profile?.neighborhood ?? '—'}
      </p>
      <p>
        <strong>Member since:</strong> {new Date(member.created_at).toLocaleDateString()}
      </p>
      {canEdit && <button onClick={handleEditClick}>Edit profile</button>}
    </section>
  )
}

export default ProfilePage
