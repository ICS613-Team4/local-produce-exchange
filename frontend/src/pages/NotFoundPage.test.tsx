// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

import App from '../App'

// These tests render App itself, not NotFoundPage alone, because the slice
// is about the catch-all route. App already creates BrowserRouter, so the
// tests must not wrap it in MemoryRouter. Instead each test sets the URL
// with window.history.pushState before rendering.

afterEach(() => {
  cleanup()
})

test('an unknown URL renders the not-found page', () => {
  window.history.pushState({}, '', '/does-not-exist')
  render(<App />)

  const heading = screen.getByRole('heading', { name: 'Page not found' })
  const bodyText = screen.getByText(/doesn't exist or has been moved/)

  expect(heading).toBeTruthy()
  expect(bodyText).toBeTruthy()
})

test('/login renders the login page now that US-02 is implemented', () => {
  window.history.pushState({}, '', '/login')
  render(<App />)

  const heading = screen.getByRole('heading', { name: 'Log in' })

  expect(heading).toBeTruthy()
})
