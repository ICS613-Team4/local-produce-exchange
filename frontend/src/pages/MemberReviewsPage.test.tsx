// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import MemberReviewsPage from './MemberReviewsPage'
import type { MemberReviewItem } from '../services/reviewService'

type FakeResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

function renderPage(search: string) {
  render(
    <MemoryRouter initialEntries={['/member-reviews' + search]}>
      <Routes>
        <Route path="/member-reviews" element={<MemberReviewsPage />} />
        <Route path="/listings/:id" element={<div>Listing Page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function makeFakeResponse(ok: boolean, status: number, body: object): FakeResponse {
  return { ok, status, text: async () => JSON.stringify(body) }
}

function makeReview(id: string, rating: number, body: string): MemberReviewItem {
  return {
    id: id,
    reviewer_name: 'Carol Chen',
    listing_id: 'listing-1',
    listing_title: "Bob's Tomatoes",
    rating: rating,
    body: body,
    created_at: '2026-07-04T09:00:00.000Z',
  }
}

function stubMemberReviews(role: string, average: number | null, reviews: MemberReviewItem[]) {
  window.localStorage.setItem('memberId', 'acting-member')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, {
      member_id: 'member-1',
      member_name: 'Bob Baker',
      role: role,
      average: average,
      count: reviews.length,
      reviews: reviews,
    })
  })
}

// ── the listing-owner view ───────────────────────────────────────────────────

test('names the member and the listing owner role in the heading', async () => {
  stubMemberReviews('listing_owner', 4.0, [makeReview('r1', 4, 'Great to work with.')])

  renderPage('?member=member-1&role=listing_owner')

  expect(await screen.findByText('Reviews for Bob Baker as a listing owner')).toBeTruthy()
  expect(
    screen.getByText(
      "This is Bob Baker's reputation as a listing owner. Their requestor reviews are counted separately.",
    ),
  ).toBeTruthy()
})

test('asks the backend for the listing owner role exactly', async () => {
  window.localStorage.setItem('memberId', 'acting-member')
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) {
      requestOptions = options
    }
    return makeFakeResponse(true, 200, {
      member_id: 'member-1',
      member_name: 'Bob Baker',
      role: 'listing_owner',
      average: 4.0,
      count: 1,
      reviews: [makeReview('r1', 4, 'Great to work with.')],
    })
  })

  renderPage('?member=member-1&role=listing_owner')

  await waitFor(() => {
    expect(requestUrl).toBe('/api/members/member-1/reviews?role=listing_owner')
  })
  // The acting member travels in the header; the viewed member is in the path.
  expect(JSON.stringify(requestOptions.headers)).toContain('acting-member')
})

test('shows the average and the review count for the role', async () => {
  stubMemberReviews('listing_owner', 4.0, [makeReview('r1', 4, 'Great to work with.')])

  renderPage('?member=member-1&role=listing_owner')

  expect(await screen.findByText('4.0')).toBeTruthy()
  expect(screen.getByText('1 review(s) as a listing owner')).toBeTruthy()
})

// ── the requestor view, and the two never crossing ───────────────────────────

test('names the requestor role everywhere on a requestor view', async () => {
  stubMemberReviews('requestor', 2.0, [makeReview('r9', 2, 'Late to the pickup.')])

  renderPage('?member=member-1&role=requestor')

  expect(await screen.findByText('Reviews for Bob Baker as a requestor')).toBeTruthy()
  expect(
    screen.getByText(
      "This is Bob Baker's reputation as a requestor. Their listing owner reviews are counted separately.",
    ),
  ).toBeTruthy()
  expect(screen.getByText('1 review(s) as a requestor')).toBeTruthy()
  expect(screen.getByText('Late to the pickup.')).toBeTruthy()
})

test('asks the backend for the requestor role exactly', async () => {
  window.localStorage.setItem('memberId', 'acting-member')
  let requestUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    requestUrl = String(url)
    return makeFakeResponse(true, 200, {
      member_id: 'member-1',
      member_name: 'Bob Baker',
      role: 'requestor',
      average: 2.0,
      count: 1,
      reviews: [makeReview('r9', 2, 'Late to the pickup.')],
    })
  })

  renderPage('?member=member-1&role=requestor')

  // The same member as the listing-owner test above, so a crossed role would
  // show up right here.
  await waitFor(() => {
    expect(requestUrl).toBe('/api/members/member-1/reviews?role=requestor')
  })
})

// ── the two tabs ─────────────────────────────────────────────────────────────

test('marks the listing owner tab as the current one on a listing owner view', async () => {
  stubMemberReviews('listing_owner', 4.0, [makeReview('r1', 4, 'Great.')])

  renderPage('?member=member-1&role=listing_owner')

  const ownerTab = await screen.findByRole('link', { name: 'As a listing owner' })
  const requestorTab = screen.getByRole('link', { name: 'As a requestor' })
  expect(ownerTab.getAttribute('aria-current')).toBe('page')
  expect(requestorTab.getAttribute('aria-current')).toBeNull()
})

test('marks the requestor tab as the current one on a requestor view', async () => {
  stubMemberReviews('requestor', 2.0, [makeReview('r9', 2, 'Late.')])

  renderPage('?member=member-1&role=requestor')

  const ownerTab = await screen.findByRole('link', { name: 'As a listing owner' })
  const requestorTab = screen.getByRole('link', { name: 'As a requestor' })
  expect(requestorTab.getAttribute('aria-current')).toBe('page')
  expect(ownerTab.getAttribute('aria-current')).toBeNull()
})

test('each tab points at the same member with its own role', async () => {
  stubMemberReviews('listing_owner', 4.0, [makeReview('r1', 4, 'Great.')])

  renderPage('?member=member-1&role=listing_owner')

  const ownerTab = await screen.findByRole('link', { name: 'As a listing owner' })
  const requestorTab = screen.getByRole('link', { name: 'As a requestor' })
  expect(ownerTab.getAttribute('href')).toBe('/member-reviews?member=member-1&role=listing_owner')
  expect(requestorTab.getAttribute('href')).toBe('/member-reviews?member=member-1&role=requestor')
})

// ── the rating breakdown ─────────────────────────────────────────────────────

test('counts how the ratings split across the five star levels', async () => {
  const reviews = [
    makeReview('r1', 5, 'five a'),
    makeReview('r2', 5, 'five b'),
    makeReview('r3', 4, 'four'),
    makeReview('r4', 1, 'one'),
  ]
  stubMemberReviews('listing_owner', 3.75, reviews)

  renderPage('?member=member-1&role=listing_owner')

  expect(await screen.findByLabelText('5 stars: 2 reviews')).toBeTruthy()
  expect(screen.getByLabelText('4 stars: 1 reviews')).toBeTruthy()
  expect(screen.getByLabelText('3 stars: 0 reviews')).toBeTruthy()
  expect(screen.getByLabelText('2 stars: 0 reviews')).toBeTruthy()
  expect(screen.getByLabelText('1 stars: 1 reviews')).toBeTruthy()
})

// ── one review row ───────────────────────────────────────────────────────────

test('a review row names its reviewer, its text, and its listing', async () => {
  stubMemberReviews('listing_owner', 4.0, [makeReview('r1', 4, 'Great to work with.')])

  renderPage('?member=member-1&role=listing_owner')

  expect(await screen.findByText('Carol Chen')).toBeTruthy()
  expect(screen.getByText('Great to work with.')).toBeTruthy()
  const listingLink = screen.getByRole('link', { name: "Bob's Tomatoes" })
  expect(listingLink.getAttribute('href')).toBe('/listings/listing-1')
})

test('leaves out the body line for a rating-only review', async () => {
  stubMemberReviews('listing_owner', 4.0, [makeReview('r1', 4, '')])

  renderPage('?member=member-1&role=listing_owner')

  expect(await screen.findByText('Carol Chen')).toBeTruthy()
  // Two star rows: the summary's rounded average and this one review's own.
  // The row renders no empty body paragraph between them.
  expect(screen.getAllByLabelText('Rated 4 out of 5').length).toBe(2)
  const bodyParagraphs = document.querySelectorAll('.whitespace-pre-wrap')
  expect(bodyParagraphs.length).toBe(0)
})

// ── the empty and broken states ──────────────────────────────────────────────

test('says the role has no reviews yet, with no average and no bars', async () => {
  stubMemberReviews('requestor', null, [])

  renderPage('?member=member-1&role=requestor')

  expect(await screen.findByText('Bob Baker has no requestor reviews yet.')).toBeTruthy()
  expect(screen.getByText('Check their listing owner reviews.')).toBeTruthy()
  // No zero score, no empty breakdown, and no error.
  expect(screen.queryByText('0.0')).toBeNull()
  expect(screen.queryByLabelText('5 stars: 0 reviews')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

test('refuses an unknown role without calling the backend', async () => {
  window.localStorage.setItem('memberId', 'acting-member')
  let calls = 0
  vi.stubGlobal('fetch', async () => {
    calls = calls + 1
    return makeFakeResponse(true, 200, {})
  })

  renderPage('?member=member-1&role=owner')

  expect(await screen.findByText('That is not a rating we can show.')).toBeTruthy()
  expect(calls).toBe(0)
})

test('refuses a missing role without calling the backend', async () => {
  window.localStorage.setItem('memberId', 'acting-member')
  let calls = 0
  vi.stubGlobal('fetch', async () => {
    calls = calls + 1
    return makeFakeResponse(true, 200, {})
  })

  renderPage('?member=member-1')

  expect(await screen.findByText('That is not a rating we can show.')).toBeTruthy()
  expect(calls).toBe(0)
})

test('refuses a missing member without calling the backend', async () => {
  window.localStorage.setItem('memberId', 'acting-member')
  let calls = 0
  vi.stubGlobal('fetch', async () => {
    calls = calls + 1
    return makeFakeResponse(true, 200, {})
  })

  renderPage('?role=listing_owner')

  expect(await screen.findByText('That is not a rating we can show.')).toBeTruthy()
  expect(calls).toBe(0)
})

test('shows the not-found message for a member who does not exist', async () => {
  window.localStorage.setItem('memberId', 'acting-member')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 404, { detail: 'Member not found.' })
  })

  renderPage('?member=nobody&role=listing_owner')

  expect(await screen.findByText('Member not found.')).toBeTruthy()
})

test('falls back to its own message when the backend sends no detail', async () => {
  window.localStorage.setItem('memberId', 'acting-member')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 500, {})
  })

  renderPage('?member=member-1&role=listing_owner')

  expect(await screen.findByText('Could not load the reviews. Please try again.')).toBeTruthy()
})

test('shows the request failure message when the call cannot be made', async () => {
  window.localStorage.setItem('memberId', 'acting-member')
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  renderPage('?member=member-1&role=listing_owner')

  expect(await screen.findByText('Request failed: TypeError: Failed to fetch')).toBeTruthy()
})

test('clears a rejected login instead of rendering its own message', async () => {
  window.localStorage.setItem('memberId', 'stale-member')
  window.localStorage.setItem('memberEmail', 'stale@example.com')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 401, { detail: 'Not authenticated.' })
  })

  renderPage('?member=member-1&role=listing_owner')

  await waitFor(() => {
    expect(window.localStorage.getItem('memberId')).toBeNull()
  })
  expect(window.localStorage.getItem('memberEmail')).toBeNull()
})
