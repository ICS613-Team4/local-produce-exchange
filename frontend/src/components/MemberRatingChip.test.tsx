// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test } from 'vitest'

import MemberRatingChip from './MemberRatingChip'

afterEach(() => {
  cleanup()
})

// The chip is a router link now (US-21), so every render needs a router
// around it. The no-rating branch is plain text and would not need one, but
// wrapping it too keeps the helper single-shaped.
function renderChip(
  memberId: string,
  role: 'listing_owner' | 'requestor',
  average: number | null,
  count: number,
) {
  render(
    <MemoryRouter>
      <MemberRatingChip memberId={memberId} role={role} average={average} count={count} />
    </MemoryRouter>,
  )
}

test('renders the average, without the count, as a role-named link', () => {
  renderChip('member-1', 'requestor', 4.3, 12)

  const chipLink = screen.getByRole('link', {
    name: "View the reviews behind this member's rating as a requestor",
  })
  expect(chipLink.textContent).toBe('(★ 4.3 requestor rating)')
  // The review count is not shown anywhere on the chip.
  expect(chipLink.textContent).not.toContain('12')
})

test('a requestor chip opens that member\'s requestor reviews', () => {
  renderChip('member-1', 'requestor', 4.3, 12)

  const chipLink = screen.getByRole('link', {
    name: "View the reviews behind this member's rating as a requestor",
  })
  expect(chipLink.getAttribute('href')).toBe('/member-reviews?member=member-1&role=requestor')
})

test('a listing owner chip opens that member\'s listing owner reviews', () => {
  renderChip('member-7', 'listing_owner', 3.5, 2)

  const chipLink = screen.getByRole('link', {
    name: "View the reviews behind this member's rating as a listing owner",
  })
  // The SAME member can have both reputations, so the role in the link is
  // what keeps the two apart.
  expect(chipLink.getAttribute('href')).toBe('/member-reviews?member=member-7&role=listing_owner')
})

test('says no rating, without a link, when there are no reviews', () => {
  renderChip('member-1', 'requestor', null, 0)

  expect(screen.getByText('(no requestor rating)')).toBeTruthy()
  // Nothing to open, so nothing to click.
  expect(screen.queryByRole('link')).toBeNull()
})

test('a zero count says no rating even with an average value', () => {
  renderChip('member-1', 'listing_owner', 5, 0)

  expect(screen.getByText('(no listing owner rating)')).toBeTruthy()
  expect(screen.queryByRole('link')).toBeNull()
})

test('the accessible name says listing owner for the owner reputation', () => {
  renderChip('member-1', 'listing_owner', 3.5, 2)

  const chipLink = screen.getByRole('link', {
    name: "View the reviews behind this member's rating as a listing owner",
  })
  expect(chipLink.textContent).toBe('(★ 3.5 listing owner rating)')
})
