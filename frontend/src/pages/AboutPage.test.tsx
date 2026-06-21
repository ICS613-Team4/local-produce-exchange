// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test } from 'vitest'

import AboutPage from './AboutPage'

afterEach(() => {
  cleanup()
})

test('shows the about page heading and placeholder text', () => {
  render(
    <MemoryRouter>
      <AboutPage />
    </MemoryRouter>,
  )

  const heading = screen.getByRole('heading', { name: 'ICS 613 Team 4: About Page' })
  const placeholderText = screen.getByText(/Lorem ipsum dolor sit amet/)

  expect(heading).toBeTruthy()
  expect(placeholderText).toBeTruthy()
})
