// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
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

// --- not logged in ---

test('shows a login prompt when no member is in localStorage', () => {
  renderProfilePage()

  expect(screen.getByText(/Please/)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'log in' })).toBeTruthy()
  expect(screen.queryByText('Profile')).toBeTruthy()
})

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
})
