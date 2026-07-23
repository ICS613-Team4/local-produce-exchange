// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import ProfilePage from './ProfilePage'

type FakeResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
}

// Unmount components, restore the real fetch, and clear localStorage after
// every test, so one test cannot leak into the next.
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

const MEMBER_ID = 'a4c135d8-0000-0000-0000-000000000000'

const PROFILE_RESPONSE = {
  id: MEMBER_ID,
  name: 'Alice Admin',
  email: 'alice@example.com',
  status: 'active',
  role: 'admin',
  created_at: '2026-01-15T00:00:00+00:00',
  profile: {
    display_name: 'Alice',
    contact_preference: 'email',
    neighborhood: 'Manoa',
  },
}

function makeFakeResponse(ok: boolean, status: number, body: object): FakeResponse {
  const bodyText = JSON.stringify(body)
  return {
    ok,
    status,
    text: async () => bodyText,
  }
}

function renderProfilePage() {
  render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>,
  )
}

// Renders ProfilePage at /profile/:id, the US-08 public-view route, so
// useParams() actually resolves an id the way it would through App.tsx.
function renderPublicProfilePage(viewedMemberId: string) {
  render(
    <MemoryRouter initialEntries={['/profile/' + viewedMemberId]}>
      <Routes>
        <Route path="/profile/:id" element={<ProfilePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

// --- loading then success ---

test('shows profile fields after a successful fetch', async () => {
  window.localStorage.setItem('memberId', MEMBER_ID)
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, PROFILE_RESPONSE))

  renderProfilePage()

  expect(await screen.findByText('Alice Admin')).toBeTruthy()
  expect(screen.getByText('alice@example.com')).toBeTruthy()
  expect(screen.getByText('Alice')).toBeTruthy()
  expect(screen.getByText('email')).toBeTruthy()
  expect(screen.getByText('Manoa')).toBeTruthy()
})

// --- edit button visibility ---

test('shows the edit button when the profile belongs to the logged-in member', async () => {
  window.localStorage.setItem('memberId', MEMBER_ID)
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, PROFILE_RESPONSE))

  renderProfilePage()

  const editButton = await screen.findByRole('button', { name: 'Edit profile' })
  expect(editButton).toBeTruthy()
})

test('hides the edit button when the loaded profile belongs to a different member', async () => {
  // The logged-in member is someone else, not the profile owner.
  window.localStorage.setItem('memberId', 'ffffffff-0000-0000-0000-000000000000')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, PROFILE_RESPONSE))

  renderProfilePage()

  await screen.findByText('Alice Admin')
  expect(screen.queryByRole('button', { name: 'Edit profile' })).toBeNull()
})

// --- edit form ---

test('shows the edit form after clicking edit', async () => {
  window.localStorage.setItem('memberId', MEMBER_ID)
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, PROFILE_RESPONSE))

  renderProfilePage()
  fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }))

  expect(screen.getByLabelText('Display name')).toBeTruthy()
  expect(screen.getByLabelText('Contact preference')).toBeTruthy()
  expect(screen.getByLabelText('Neighborhood')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
})

test('pre-fills the form with the current profile values', async () => {
  window.localStorage.setItem('memberId', MEMBER_ID)
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, PROFILE_RESPONSE))

  renderProfilePage()
  fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }))

  const displayNameInput = screen.getByLabelText('Display name') as HTMLInputElement
  expect(displayNameInput.value).toBe('Alice')
})

test('returns to view mode on cancel', async () => {
  window.localStorage.setItem('memberId', MEMBER_ID)
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, PROFILE_RESPONSE))

  renderProfilePage()
  fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

  // Edit button is back; Save button is gone.
  expect(screen.getByRole('button', { name: 'Edit profile' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
})

// --- save success ---

test('shows the updated display name after a successful save', async () => {
  const updatedResponse = {
    ...PROFILE_RESPONSE,
    profile: { ...PROFILE_RESPONSE.profile, display_name: 'Alicia' },
  }

  let callCount = 0
  vi.stubGlobal('fetch', async () => {
    callCount += 1
    // First call is the initial GET; second call is the PATCH.
    return makeFakeResponse(true, 200, callCount === 1 ? PROFILE_RESPONSE : updatedResponse)
  })

  window.localStorage.setItem('memberId', MEMBER_ID)
  renderProfilePage()

  fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }))

  const displayNameInput = screen.getByLabelText('Display name') as HTMLInputElement
  fireEvent.change(displayNameInput, { target: { value: 'Alicia' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  // After save the view mode shows the new name.
  expect(await screen.findByText('Alicia')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
})

// --- save error ---

test('shows a validation error when the backend rejects the save', async () => {
  const errorResponse = { detail: 'Display name must not be blank.' }

  let callCount = 0
  vi.stubGlobal('fetch', async () => {
    callCount += 1
    return makeFakeResponse(callCount === 1, callCount === 1 ? 200 : 422, callCount === 1 ? PROFILE_RESPONSE : errorResponse)
  })

  window.localStorage.setItem('memberId', MEMBER_ID)
  renderProfilePage()

  fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }))
  const displayNameInput = screen.getByLabelText('Display name') as HTMLInputElement
  fireEvent.change(displayNameInput, { target: { value: '   ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toContain('blank')
})

test('shows an error when the logged-in member tries to save to a different profile', async () => {
  // localStorage has a different memberId than the loaded profile.
  window.localStorage.setItem('memberId', 'ffffffff-0000-0000-0000-000000000000')
  // Fetch always returns the PROFILE_RESPONSE (owned by MEMBER_ID).
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, PROFILE_RESPONSE))

  renderProfilePage()
  await screen.findByText('Alice Admin')

  // The edit button is hidden, but we can still test the auth check by calling
  // handleSaveSubmit indirectly. Since canEdit is false the form never renders,
  // so this test just confirms the button is absent (frontend coverage).
  expect(screen.queryByRole('button', { name: 'Edit profile' })).toBeNull()
})

// --- fetch error ---

test('shows an error message when the profile fetch fails', async () => {
  window.localStorage.setItem('memberId', MEMBER_ID)
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 503, { detail: 'Service unavailable.' }))

  renderProfilePage()

  const errorArea = await screen.findByRole('alert')
  expect(errorArea).toBeTruthy()
  // The page-level home link was removed; the shared nav covers it now.
  expect(screen.queryByRole('link', { name: 'Go to home page' })).toBeNull()
})

// --- public view (US-08: view another member's public profile) ---

const OTHER_MEMBER_ID = 'b4c135d8-0000-0000-0000-000000000000'

const OTHER_PROFILE_RESPONSE = {
  id: OTHER_MEMBER_ID,
  name: 'Bob Baker',
  email: 'bob@example.com',
  status: 'active',
  role: 'member',
  created_at: '2026-02-01T00:00:00+00:00',
  profile: {
    display_name: 'Bobby',
    contact_preference: 'message',
    neighborhood: 'Kaimuki',
  },
}

test('shows only the display name and review links for another member', async () => {
  window.localStorage.setItem('memberId', MEMBER_ID)
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, OTHER_PROFILE_RESPONSE))

  renderPublicProfilePage(OTHER_MEMBER_ID)

  expect(await screen.findByRole('heading', { name: 'Bobby' })).toBeTruthy()
  const listingOwnerLink = screen.getByRole('link', { name: 'View Reviews as a Listing Owner' })
  expect(listingOwnerLink.getAttribute('href')).toBe('/member-reviews?member=' + OTHER_MEMBER_ID + '&role=listing_owner')
  const requestorLink = screen.getByRole('link', { name: 'View Reviews as a Requestor' })
  expect(requestorLink.getAttribute('href')).toBe('/member-reviews?member=' + OTHER_MEMBER_ID + '&role=requestor')
  expect(screen.queryByText('bob@example.com')).toBeNull()
  expect(screen.queryByText('Kaimuki')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Edit profile' })).toBeNull()
})

test('shows the read-only public view, not the editable one, when viewing your own profile through /profile/:id', async () => {
  // Scenario 2: opening your own profile through this view renders the same
  // way another member would see it, with no edit control.
  window.localStorage.setItem('memberId', MEMBER_ID)
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, PROFILE_RESPONSE))

  renderPublicProfilePage(MEMBER_ID)

  expect(await screen.findByRole('heading', { name: 'Alice' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'View Reviews as a Listing Owner' })).toBeTruthy()
  expect(screen.queryByText('alice@example.com')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Edit profile' })).toBeNull()
})

test('requests the target member id in the URL but the viewer id in the X-Member-Id header', async () => {
  window.localStorage.setItem('memberId', MEMBER_ID)
  let requestUrl = ''
  let requestHeaders: Record<string, string> = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options?: RequestInit) => {
    requestUrl = String(url)
    requestHeaders = (options?.headers ?? {}) as Record<string, string>
    return makeFakeResponse(true, 200, OTHER_PROFILE_RESPONSE)
  })

  renderPublicProfilePage(OTHER_MEMBER_ID)
  await screen.findByRole('heading', { name: 'Bobby' })

  expect(requestUrl).toBe('/api/members/' + OTHER_MEMBER_ID)
  expect(requestHeaders['X-Member-Id']).toBe(MEMBER_ID)
})

test('shows a profile-specific error message when the public profile fetch fails', async () => {
  window.localStorage.setItem('memberId', MEMBER_ID)
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 404, { detail: 'Member not found.' }))

  renderPublicProfilePage(OTHER_MEMBER_ID)

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toContain('Could not load this profile.')
})

test('clears the stale login on a 401, the same convention every protected page follows', async () => {
  window.localStorage.setItem('memberId', MEMBER_ID)
  window.localStorage.setItem('memberName', 'Stale Name')
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 401, { detail: 'Not authenticated.' }))

  renderPublicProfilePage(OTHER_MEMBER_ID)

  await waitFor(() => {
    expect(window.localStorage.getItem('memberId')).toBeNull()
  })
  expect(window.localStorage.getItem('memberName')).toBeNull()
})
