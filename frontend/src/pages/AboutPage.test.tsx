// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test } from 'vitest'

import AboutPage from './AboutPage'

afterEach(() => {
  cleanup()
})

test('shows the about page heading and home link', () => {
  render(
    <MemoryRouter>
      <AboutPage />
    </MemoryRouter>,
  )

  const heading = screen.getByRole('heading', { name: 'About page' })
  const placeholderText = screen.getByText(/Lorem ipsum dolor sit amet/)
  const homeLink = screen.getByRole('link', { name: 'Go to home page' })

  expect(heading).toBeTruthy()
  expect(placeholderText).toBeTruthy()
  expect(homeLink.getAttribute('href')).toBe('/')
})
