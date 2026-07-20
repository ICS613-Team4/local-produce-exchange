// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'

import MemberRatingChip from './MemberRatingChip'

afterEach(() => {
  cleanup()
})

test('renders the average, without the count, as a clickable role-named button', () => {
  render(
    <MemberRatingChip memberId="member-1" role="requestor" average={4.3} count={12} />,
  )

  const chipButton = screen.getByRole('button', {
    name: "View the reviews behind this member's rating as a requestor",
  })
  expect(chipButton.textContent).toBe('(★ 4.3 requestor rating)')
  // The review count is not shown anywhere on the chip.
  expect(chipButton.textContent).not.toContain('12')

  // The click is the US-21 placeholder no-op; it must not throw.
  fireEvent.click(chipButton)
  expect(chipButton.textContent).toBe('(★ 4.3 requestor rating)')
})

test('says no rating, without a button, when there are no reviews', () => {
  render(
    <MemberRatingChip memberId="member-1" role="requestor" average={null} count={0} />,
  )

  expect(screen.getByText('(no requestor rating)')).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})

test('a zero count says no rating even with an average value', () => {
  render(
    <MemberRatingChip memberId="member-1" role="listing_owner" average={5} count={0} />,
  )

  expect(screen.getByText('(no listing owner rating)')).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
})

test('the accessible name says listing owner for the owner reputation', () => {
  render(
    <MemberRatingChip memberId="member-1" role="listing_owner" average={3.5} count={2} />,
  )

  const chipButton = screen.getByRole('button', {
    name: "View the reviews behind this member's rating as a listing owner",
  })
  expect(chipButton.textContent).toBe('(★ 3.5 listing owner rating)')
})
