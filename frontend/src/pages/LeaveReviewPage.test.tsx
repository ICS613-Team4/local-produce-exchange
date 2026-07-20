// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import LeaveReviewPage from './LeaveReviewPage'
import type { ReviewContext, ReviewResponse } from '../services/reviewService'

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
    <MemoryRouter initialEntries={[`/review${search}`]}>
      <Routes>
        <Route path="/review" element={<LeaveReviewPage />} />
        <Route path="/dashboard" element={<div>Dashboard Page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function makeFakeResponse(ok: boolean, status: number, body: object): FakeResponse {
  return { ok, status, text: async () => JSON.stringify(body) }
}

// The recipient side: the caller is the requestor and the other party is the
// poster. No review exists yet.
function makeRecipientContext(): ReviewContext {
  return {
    claim_id: 'claim-1',
    listing_id: 'listing-1',
    listing_title: 'Fresh Manoa Lettuce',
    role: 'requestor',
    other_party_id: 'member-2',
    other_party_name: 'Bob Baker',
    completed_at: '2026-07-04T09:00:00.000Z',
    already_reviewed: false,
    existing_review: null,
    can_edit: false,
  }
}

// The poster side: same exchange seen by the listing owner.
function makePosterContext(): ReviewContext {
  const context = makeRecipientContext()
  context.role = 'listing_owner'
  context.other_party_name = 'Carol Chen'
  context.other_party_id = 'member-3'
  return context
}

function makeExistingReview(): ReviewResponse {
  return {
    id: 'review-1',
    claim_id: 'claim-1',
    reviewer_id: 'member-1',
    reviewee_id: 'member-2',
    reviewee_role: 'listing_owner',
    rating: 3,
    body: 'ok',
    created_at: '2026-07-05T09:00:00.000Z',
    updated_at: '2026-07-05T09:00:00.000Z',
    is_disabled: false,
  }
}

function makeEditableContext(): ReviewContext {
  const context = makeRecipientContext()
  context.already_reviewed = true
  context.existing_review = makeExistingReview()
  context.can_edit = true
  return context
}

function makeDisabledContext(): ReviewContext {
  const context = makeRecipientContext()
  const review = makeExistingReview()
  review.is_disabled = true
  context.already_reviewed = true
  context.existing_review = review
  context.can_edit = false
  return context
}

// ── not logged in / no claim ─────────────────────────────────────────────────

test('shows the logged-out line and calls no service without a member id', () => {
  let fetchCallCount = 0
  vi.stubGlobal('fetch', async () => {
    fetchCallCount = fetchCallCount + 1
    return makeFakeResponse(true, 200, makeRecipientContext())
  })

  renderPage()

  expect(screen.getByRole('alert').textContent).toContain('logged in')
  expect(fetchCallCount).toBe(0)
})

test('shows the no-exchange line and calls no service without a claim param', () => {
  window.localStorage.setItem('memberId', 'member-1')
  let fetchCallCount = 0
  vi.stubGlobal('fetch', async () => {
    fetchCallCount = fetchCallCount + 1
    return makeFakeResponse(true, 200, makeRecipientContext())
  })

  renderPage('')

  expect(screen.getByRole('alert').textContent).toContain('No exchange specified')
  expect(fetchCallCount).toBe(0)
})

// ── the create form, recipient side ──────────────────────────────────────────

test('renders the create form with five stars and a disabled submit', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeRecipientContext()))

  renderPage()

  await waitFor(() => screen.getByText('Fresh Manoa Lettuce'))
  expect(screen.getByText(/exchange with Bob Baker/)).toBeTruthy()
  expect(screen.getByText('You received this produce.')).toBeTruthy()

  const stars = screen.getAllByRole('radio', { name: /Rate \d out of 5/ })
  expect(stars.length).toBe(5)

  const submitButton = screen.getByRole('button', { name: 'Submit Review' })
  expect(submitButton.hasAttribute('disabled')).toBe(true)
})

test('choosing a star enables submit and creates the review', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  let createUrl = ''
  let createBody = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    if (options !== undefined && options.method === 'POST') {
      createUrl = String(url)
      createBody = String(options.body)
      return makeFakeResponse(true, 201, { id: 'review-1', rating: 4 })
    }
    return makeFakeResponse(true, 200, makeRecipientContext())
  })

  renderPage()

  await waitFor(() => screen.getByText('Fresh Manoa Lettuce'))

  const fourthStar = screen.getByRole('radio', { name: 'Rate 4 out of 5' })
  fireEvent.click(fourthStar)
  expect(fourthStar.getAttribute('aria-checked')).toBe('true')
  expect(screen.getByText('Very good')).toBeTruthy()

  const submitButton = screen.getByRole('button', { name: 'Submit Review' })
  expect(submitButton.hasAttribute('disabled')).toBe(false)

  const textarea = screen.getByLabelText('Your review (optional)')
  fireEvent.change(textarea, { target: { value: 'Great to work with.' } })
  fireEvent.click(submitButton)

  await waitFor(() => screen.getByText('Thanks. Your review has been saved.'))
  expect(createUrl).toBe('/api/claims/claim-1/reviews')
  expect(createBody).toBe('{"rating":4,"body":"Great to work with."}')
})

// ── the create form, poster side (same component, other role) ────────────────

test('the same create form serves the poster side', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  let createBody = ''
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options !== undefined && options.method === 'POST') {
      createBody = String(options.body)
      return makeFakeResponse(true, 201, { id: 'review-1', rating: 5 })
    }
    return makeFakeResponse(true, 200, makePosterContext())
  })

  renderPage()

  await waitFor(() => screen.getByText('Fresh Manoa Lettuce'))
  expect(screen.getByText(/exchange with Carol Chen/)).toBeTruthy()
  expect(screen.getByText('You posted this listing.')).toBeTruthy()

  fireEvent.click(screen.getByRole('radio', { name: 'Rate 5 out of 5' }))
  fireEvent.click(screen.getByRole('button', { name: 'Submit Review' }))

  await waitFor(() => screen.getByText('Thanks. Your review has been saved.'))
  expect(createBody).toBe('{"rating":5,"body":""}')
})

// ── the edit form (Rule 2) ────────────────────────────────────────────────────

test('an editable existing review renders the pre-filled edit form and saves through PATCH', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  let editUrl = ''
  let editMethod = ''
  let editBody = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    if (options !== undefined && options.method === 'PATCH') {
      editUrl = String(url)
      editMethod = String(options.method)
      editBody = String(options.body)
      return makeFakeResponse(true, 200, { id: 'review-1', rating: 5 })
    }
    if (options !== undefined && options.method === 'POST') {
      throw new Error('The edit form must never call the create endpoint.')
    }
    return makeFakeResponse(true, 200, makeEditableContext())
  })

  renderPage()

  await waitFor(() => screen.getByRole('heading', { name: 'Edit Your Review' }))

  // Pre-filled: the 3rd star is chosen and the textarea holds the saved body.
  const thirdStar = screen.getByRole('radio', { name: 'Rate 3 out of 5' })
  expect(thirdStar.getAttribute('aria-checked')).toBe('true')
  const textarea = screen.getByLabelText('Your review (optional)') as HTMLTextAreaElement
  expect(textarea.value).toBe('ok')

  const saveButton = screen.getByRole('button', { name: 'Save Changes' })
  expect(saveButton).toBeTruthy()

  fireEvent.click(screen.getByRole('radio', { name: 'Rate 5 out of 5' }))
  fireEvent.change(textarea, { target: { value: 'Even better than I thought.' } })
  fireEvent.click(saveButton)

  await waitFor(() => screen.getByText('Your review has been updated.'))
  expect(editUrl).toBe('/api/claims/claim-1/review')
  expect(editMethod).toBe('PATCH')
  expect(editBody).toBe('{"rating":5,"body":"Even better than I thought."}')
})

// ── the frozen panel (Rule 3) ─────────────────────────────────────────────────

test('a disabled review renders the frozen panel with no form at all', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeDisabledContext()))

  renderPage()

  await waitFor(() => screen.getByRole('alert'))

  const alertText = screen.getByRole('alert').textContent ?? ''
  expect(alertText).toContain('administrator')
  expect(alertText).toContain('disabled')
  expect(alertText).toContain('cannot edit')

  // The saved review still shows, read-only.
  expect(screen.getByText('ok')).toBeTruthy()

  // No star inputs, no textarea, no submit button of either kind.
  expect(screen.queryByRole('radio', { name: /Rate/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /Rate/ })).toBeNull()
  expect(screen.queryByLabelText('Your review (optional)')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Save Changes' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Submit Review' })).toBeNull()
})

// ── server messages surfacing ────────────────────────────────────────────────

test('a 409 on create shows the server duplicate message', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options !== undefined && options.method === 'POST') {
      return makeFakeResponse(false, 409, { detail: 'You have already reviewed this exchange.' })
    }
    return makeFakeResponse(true, 200, makeRecipientContext())
  })

  renderPage()

  await waitFor(() => screen.getByText('Fresh Manoa Lettuce'))
  fireEvent.click(screen.getByRole('radio', { name: 'Rate 4 out of 5' }))
  fireEvent.click(screen.getByRole('button', { name: 'Submit Review' }))

  await waitFor(() => screen.getByRole('alert'))
  expect(screen.getByRole('alert').textContent).toContain('already reviewed')
})

test('a disabled 403 on edit shows the server message', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  const disabledDetail =
    'An administrator disabled your review for this exchange because it broke ' +
    'the community rules. You cannot edit it or leave a new review for this exchange.'
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options !== undefined && options.method === 'PATCH') {
      return makeFakeResponse(false, 403, { detail: disabledDetail })
    }
    return makeFakeResponse(true, 200, makeEditableContext())
  })

  renderPage()

  await waitFor(() => screen.getByRole('heading', { name: 'Edit Your Review' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

  await waitFor(() => screen.getByRole('alert'))
  const alertText = screen.getByRole('alert').textContent ?? ''
  expect(alertText).toContain('administrator')
  expect(alertText).toContain('disabled')
})

test('hovering a star previews its fill and word, and leaving resets it', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeRecipientContext()))

  renderPage()

  await waitFor(() => screen.getByText('Fresh Manoa Lettuce'))

  const firstStar = screen.getByRole('radio', { name: 'Rate 1 out of 5' })
  fireEvent.mouseEnter(firstStar)
  expect(screen.getByText('Poor')).toBeTruthy()
  fireEvent.mouseLeave(firstStar)
  expect(screen.queryByText('Poor')).toBeNull()

  const secondStar = screen.getByRole('radio', { name: 'Rate 2 out of 5' })
  fireEvent.mouseEnter(secondStar)
  expect(screen.getByText('Fair')).toBeTruthy()
  fireEvent.mouseLeave(secondStar)

  // Hovering never locks a rating, so submit stays disabled.
  const submitButton = screen.getByRole('button', { name: 'Submit Review' })
  expect(submitButton.hasAttribute('disabled')).toBe(true)
})

test('a 401 on load clears the stored member id', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  window.localStorage.setItem('memberName', 'Member One')
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 401, { detail: 'Not authenticated.' }))

  renderPage()

  await waitFor(() => {
    expect(window.localStorage.getItem('memberId')).toBeNull()
  })
  expect(window.localStorage.getItem('memberName')).toBeNull()
})

test('a network failure on load shows the error message', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  renderPage()

  await waitFor(() => screen.getByRole('alert'))
  expect(screen.getByRole('alert').textContent).toContain('Timeout')
})

test('a network failure on submit shows the error message', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options !== undefined && options.method === 'POST') {
      throw new DOMException('The operation timed out.', 'TimeoutError')
    }
    return makeFakeResponse(true, 200, makeRecipientContext())
  })

  renderPage()

  await waitFor(() => screen.getByText('Fresh Manoa Lettuce'))
  fireEvent.click(screen.getByRole('radio', { name: 'Rate 4 out of 5' }))
  fireEvent.click(screen.getByRole('button', { name: 'Submit Review' }))

  await waitFor(() => screen.getByRole('alert'))
  expect(screen.getByRole('alert').textContent).toContain('Timeout')
})

test('a failed load shows the server message', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async () =>
    makeFakeResponse(false, 403, { detail: 'You can only review an exchange you took part in.' }),
  )

  renderPage()

  await waitFor(() => screen.getByRole('alert'))
  expect(screen.getByRole('alert').textContent).toContain(
    'You can only review an exchange you took part in.',
  )
})

// --- the page title follows the page state ---

test('the title reads Leave a Review before a first review', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeRecipientContext()))

  renderPage()

  await waitFor(() => screen.getByText('Fresh Manoa Lettuce'))
  expect(screen.getByRole('heading', { level: 1, name: 'Leave a Review' })).toBeTruthy()
})

test('the title reads Your Review on the frozen panel', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeDisabledContext()))

  renderPage()

  await waitFor(() => screen.getByRole('alert'))
  expect(screen.getByRole('heading', { level: 1, name: 'Your Review' })).toBeTruthy()
})

test('the title reads Review Saved after a save', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options !== undefined && options.method === 'POST') {
      return makeFakeResponse(true, 201, { id: 'review-1', rating: 4 })
    }
    return makeFakeResponse(true, 200, makeRecipientContext())
  })

  renderPage()

  await waitFor(() => screen.getByText('Fresh Manoa Lettuce'))
  fireEvent.click(screen.getByRole('radio', { name: 'Rate 4 out of 5' }))
  fireEvent.click(screen.getByRole('button', { name: 'Submit Review' }))

  await waitFor(() => screen.getByText('Thanks. Your review has been saved.'))
  expect(screen.getByRole('heading', { level: 1, name: 'Review Saved' })).toBeTruthy()
})
