// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test } from 'vitest'

import AdminDashboardPage from './AdminDashboardPage'

afterEach(() => {
  cleanup()
})

function renderDashboardPage() {
  render(
    <MemoryRouter>
      <AdminDashboardPage />
    </MemoryRouter>,
  )
}

test('shows the heading', () => {
  renderDashboardPage()

  expect(screen.getByRole('heading', { name: 'Admin Dashboard' })).toBeTruthy()
})

test('links to the member search page', () => {
  renderDashboardPage()

  const link = screen.getByRole('link', { name: /Manage Members/ })
  expect(link.getAttribute('href')).toBe('/admin/members')
})

test('links to the listings management page', () => {
  renderDashboardPage()

  const link = screen.getByRole('link', { name: /Manage Listings/ })
  expect(link.getAttribute('href')).toBe('/admin/listings')
})

test('links to the activity report page', () => {
  renderDashboardPage()

  const link = screen.getByRole('link', { name: /Activity Report/ })
  expect(link.getAttribute('href')).toBe('/admin/reports')
})
