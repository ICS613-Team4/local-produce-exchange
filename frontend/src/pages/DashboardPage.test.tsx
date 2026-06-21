// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test } from 'vitest'

import DashboardPage from './DashboardPage'

afterEach(() => {
  cleanup()
})

// Renders the dashboard at /dashboard. The page no longer reads navigation
// state, so the helper takes no arguments.
function renderDashboard() {
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

test('shows the title and the member action links', () => {
  renderDashboard()

  expect(screen.getByRole('heading', { name: 'Member Dashboard' })).toBeTruthy()

  const createLink = screen.getByRole('link', { name: 'Create a listing' })
  expect(createLink.getAttribute('href')).toBe('/listings/create')

  // Moved here from the nav, so the dashboard is the one place that gathers the
  // member actions.
  const inviteLink = screen.getByRole('link', { name: 'Invite a new member' })
  expect(inviteLink.getAttribute('href')).toBe('/invite')

  const profileLink = screen.getByRole('link', { name: 'View profile' })
  expect(profileLink.getAttribute('href')).toBe('/profile')
})
