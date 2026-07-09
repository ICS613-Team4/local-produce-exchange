// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test } from 'vitest'

import HomePage from './HomePage'

afterEach(() => {
  cleanup()
})

// HomePage has links now, so it needs a router wrapper.
function renderHomePage() {
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  )
}

test('shows the welcome heading', () => {
  renderHomePage()
  const heading = screen.getByRole('heading', { name: 'Welcome to Surplus' })
  expect(heading).toBeTruthy()
})

test('shows welcoming copy about the produce exchange', () => {
  renderHomePage()
  // A few words from the body copy, so the test breaks if the welcome text is
  // removed but does not pin every word.
  expect(screen.getByText(/local produce exchange/)).toBeTruthy()
  expect(screen.getByText(/good food gets shared/)).toBeTruthy()
})

test('links to the login and register pages', () => {
  renderHomePage()

  const loginLink = screen.getByRole('link', { name: 'Log in' })
  expect(loginLink.getAttribute('href')).toBe('/login')

  const registerLink = screen.getByRole('link', {
    name: 'Register with an invite',
  })
  expect(registerLink.getAttribute('href')).toBe('/register')
})

test('no longer shows the backend test controls', () => {
  // Those moved to the Test page, so the home page must not carry them.
  renderHomePage()
  expect(screen.queryByText('Call backend API with valid JSON')).toBeNull()
})
