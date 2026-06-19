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

test('shows the title and the navigation links', () => {
  renderDashboard()

  expect(screen.getByRole('heading', { name: 'Member Dashboard' })).toBeTruthy()

  const homeLink = screen.getByRole('link', { name: 'Go to home page' })
  expect(homeLink.getAttribute('href')).toBe('/')

  const aboutLink = screen.getByRole('link', { name: 'Go to about page' })
  expect(aboutLink.getAttribute('href')).toBe('/about')

  const createLink = screen.getByRole('link', { name: 'Create a listing' })
  expect(createLink.getAttribute('href')).toBe('/listings/create')
})
