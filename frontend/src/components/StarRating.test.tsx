// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

import StarRating from './StarRating'

afterEach(() => {
  cleanup()
})

test('renders five stars', () => {
  const { container } = render(<StarRating rating={3} />)

  const stars = container.querySelectorAll('span')
  expect(stars.length).toBe(5)
})

test('fills exactly as many stars as the rating', () => {
  const { container } = render(<StarRating rating={3} />)

  const stars = container.querySelectorAll('span')
  let filled = 0
  for (let index = 0; index < stars.length; index = index + 1) {
    if (stars[index].className.includes('text-amber-500')) {
      filled = filled + 1
    }
  }
  expect(filled).toBe(3)
})

test('fills every star for a five star rating', () => {
  const { container } = render(<StarRating rating={5} />)

  const stars = container.querySelectorAll('span')
  let filled = 0
  for (let index = 0; index < stars.length; index = index + 1) {
    if (stars[index].className.includes('text-amber-500')) {
      filled = filled + 1
    }
  }
  expect(filled).toBe(5)
})

test('fills one star for a one star rating', () => {
  const { container } = render(<StarRating rating={1} />)

  const stars = container.querySelectorAll('span')
  let filled = 0
  for (let index = 0; index < stars.length; index = index + 1) {
    if (stars[index].className.includes('text-amber-500')) {
      filled = filled + 1
    }
  }
  expect(filled).toBe(1)
})

test('reads out the rating as one sentence', () => {
  render(<StarRating rating={4} />)

  expect(screen.getByLabelText('Rated 4 out of 5')).toBeTruthy()
})
