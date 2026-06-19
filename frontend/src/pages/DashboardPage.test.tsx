// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test } from 'vitest'

import DashboardPage from './DashboardPage'

afterEach(() => {
  cleanup()
})

// Renders the dashboard at /dashboard. The optional state lets a test pass the
// "created" flag the create flow sends.
function renderDashboard(state: object | null) {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/dashboard', state: state }]}>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

test('shows the title and the navigation links', () => {
  renderDashboard(null)

  expect(screen.getByRole('heading', { name: 'Member Dashboard' })).toBeTruthy()

  const homeLink = screen.getByRole('link', { name: 'Go to home page' })
  expect(homeLink.getAttribute('href')).toBe('/')

  const aboutLink = screen.getByRole('link', { name: 'Go to about page' })
  expect(aboutLink.getAttribute('href')).toBe('/about')

  const createLink = screen.getByRole('link', { name: 'Create a listing' })
  expect(createLink.getAttribute('href')).toBe('/listings/create')
})

test('shows the confirmation when reached with the created flag', () => {
  renderDashboard({ created: true })

  const note = screen.getByRole('status')
  expect(note.textContent).toBe('Listing created.')
})

test('does not show the confirmation without that state', () => {
  renderDashboard(null)

  expect(screen.queryByText('Listing created.')).toBeNull()
})

test('does not show the confirmation when the state lacks the created flag', () => {
  // Reached with some other state object that has no created flag: still quiet.
  renderDashboard({ from: 'somewhere' })

  expect(screen.queryByText('Listing created.')).toBeNull()
})
