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

  const heading = screen.getByRole('heading', { name: 'About Surplus' })
  const bodyText = screen.getByText(/local produce exchange built by ICS 613 Team 4/)

  expect(heading).toBeTruthy()
  expect(bodyText).toBeTruthy()

})
