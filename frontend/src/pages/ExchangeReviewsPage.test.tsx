// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import ExchangeReviewsPage from './ExchangeReviewsPage'
import type { ReviewForClaimItem } from '../services/reviewService'

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

function renderPage(search = '?claim=claim-1') {
  render(
    <MemoryRouter initialEntries={['/exchange-reviews' + search]}>
      <Routes>
        <Route path="/exchange-reviews" element={<ExchangeReviewsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function makeFakeResponse(ok: boolean, status: number, body: object): FakeResponse {
  return { ok, status, text: async () => JSON.stringify(body) }
}

// The review Carol wrote about the member who is looking at the page.
function makeReviewAboutViewer(): ReviewForClaimItem {
  return {
    id: 'review-1',
    reviewer_id: 'member-2',
    reviewer_name: 'Carol Chen',
    reviewee_id: 'member-1',
    reviewee_name: 'Bob Baker',
    reviewee_role: 'listing_owner',
    rating: 4,
    body: 'Great to work with.',
    created_at: '2026-07-04T09:00:00.000Z',
    updated_at: '2026-07-04T09:00:00.000Z',
    about_viewer: true,
    by_viewer: false,
  }
}

// The review the viewing member wrote about the other party.
function makeReviewByViewer(): ReviewForClaimItem {
  return {
    id: 'review-2',
    reviewer_id: 'member-1',
    reviewer_name: 'Bob Baker',
    reviewee_id: 'member-2',
    reviewee_name: 'Carol Chen',
    reviewee_role: 'requestor',
    rating: 5,
    body: 'Friendly and on time.',
    created_at: '2026-07-04T10:00:00.000Z',
    updated_at: '2026-07-04T10:00:00.000Z',
    about_viewer: false,
    by_viewer: true,
  }
}

function stubReviews(reviews: ReviewForClaimItem[]) {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, {
      claim_id: 'claim-1',
      listing_title: "Bob's Tomatoes",
      reviews: reviews,
    })
  })
}

test('shows both reviews, worded for the member reading them', async () => {
  stubReviews([makeReviewAboutViewer(), makeReviewByViewer()])

  renderPage()

  // Scenario 1: the review left ABOUT the viewer is named as such.
  expect(await screen.findByText("Carol Chen's review of you")).toBeTruthy()
  expect(screen.getByText('Great to work with.')).toBeTruthy()
  expect(screen.getByText('rating 4 out of 5')).toBeTruthy()

  // And the one the viewer wrote.
  expect(screen.getByText('Your review of Carol Chen')).toBeTruthy()
  expect(screen.getByText('Friendly and on time.')).toBeTruthy()
  expect(screen.getByText('rating 5 out of 5')).toBeTruthy()
})

test('names the listing in the page heading', async () => {
  stubReviews([makeReviewAboutViewer()])

  renderPage()

  expect(await screen.findByText("Reviews for your exchange: Bob's Tomatoes")).toBeTruthy()
})

test('sends the claim id and the stored member id to the backend', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  let requestUrl = ''
  let requestOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) {
      requestOptions = options
    }
    return makeFakeResponse(true, 200, {
      claim_id: 'claim-9',
      listing_title: 'Kale',
      reviews: [],
    })
  })

  renderPage('?claim=claim-9')

  await waitFor(() => {
    expect(requestUrl).toBe('/api/claims/claim-9/reviews')
  })
  expect(JSON.stringify(requestOptions.headers)).toContain('member-1')
})

test('says there are no reviews yet when the list is empty', async () => {
  stubReviews([])

  renderPage()

  // Scenario 2.
  expect(await screen.findByText('No reviews yet for this exchange.')).toBeTruthy()
})

test('shows the backend denial message for a member who took no part', async () => {
  window.localStorage.setItem('memberId', 'member-9')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 403, {
      detail: 'You can only review an exchange you took part in.',
    })
  })

  renderPage()

  // Scenario 3, as the page sees it: the message, and no review text.
  expect(
    await screen.findByText('You can only review an exchange you took part in.'),
  ).toBeTruthy()
  expect(screen.queryByText('Great to work with.')).toBeNull()
})

test('shows the not-completed message for an unfinished exchange', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 409, {
      detail: 'You can only view reviews for a completed exchange.',
    })
  })

  renderPage()

  expect(
    await screen.findByText('You can only view reviews for a completed exchange.'),
  ).toBeTruthy()
})

test('falls back to its own message when the backend sends no detail', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 500, {})
  })

  renderPage()

  expect(
    await screen.findByText('Could not load the reviews. Please try again.'),
  ).toBeTruthy()
})

test('shows the request failure message when the call cannot be made', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  renderPage()

  expect(
    await screen.findByText('Request failed: TypeError: Failed to fetch'),
  ).toBeTruthy()
})

test('asks for nothing when no exchange was chosen', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  let calls = 0
  vi.stubGlobal('fetch', async () => {
    calls = calls + 1
    return makeFakeResponse(true, 200, { claim_id: '', listing_title: '', reviews: [] })
  })

  renderPage('')

  expect(
    await screen.findByText(
      'No exchange was chosen. Try opening this page from one of your requests.',
    ),
  ).toBeTruthy()
  expect(calls).toBe(0)
})

test('clears a rejected login instead of rendering its own message', async () => {
  window.localStorage.setItem('memberId', 'stale-member')
  window.localStorage.setItem('memberName', 'Stale')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 401, { detail: 'Not authenticated.' })
  })

  renderPage()

  // The shared guard shows the log-in message, so this page only clears the
  // stored login and leaves the rendering to it.
  await waitFor(() => {
    expect(window.localStorage.getItem('memberId')).toBeNull()
  })
  expect(window.localStorage.getItem('memberName')).toBeNull()
})

test('leaves out the body line for a rating-only review', async () => {
  const ratingOnly = makeReviewAboutViewer()
  ratingOnly.body = ''
  stubReviews([ratingOnly])

  renderPage()

  expect(await screen.findByText("Carol Chen's review of you")).toBeTruthy()
  expect(screen.queryByText('Great to work with.')).toBeNull()
})
