// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import ReviewLinks from './ReviewLinks'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

// Both links are router links, so every render needs a router around them.
function renderLinks(
  otherPartyName: string | undefined,
  fallbackName: string,
  reviewedByMe: boolean | undefined,
  linkClasses?: string,
  onDeleted?: () => void,
) {
  render(
    <MemoryRouter>
      <ReviewLinks
        claimId="claim-1"
        otherPartyName={otherPartyName}
        fallbackName={fallbackName}
        reviewedByMe={reviewedByMe}
        linkClasses={linkClasses}
        onDeleted={onDeleted}
      />
    </MemoryRouter>,
  )
}

// A fake fetch answer with only the members the service reads. A delete comes
// back as a 204 with an empty body.
function makeFakeResponse(ok: boolean, status: number, bodyText: string) {
  return { ok: ok, status: status, text: async () => bodyText }
}

test('invites a first review, by the other party first name', () => {
  renderLinks('Bob Baker', 'the poster', false)

  const reviewLink = screen.getByRole('link', { name: 'Leave a Review for Bob' })
  expect(reviewLink.getAttribute('href')).toBe('/review?claim=claim-1')
})

test('switches to the edit wording once the caller has reviewed', () => {
  renderLinks('Bob Baker', 'the poster', true)

  const editLink = screen.getByRole('link', { name: 'Edit Your Review for Bob' })
  expect(editLink.getAttribute('href')).toBe('/review?claim=claim-1')
  expect(screen.queryByRole('link', { name: /Leave a Review/ })).toBeNull()
})

test('an undefined reviewed flag reads as not reviewed', () => {
  // An older cached response can arrive without the field, and the safe
  // wording is the one that invites a review; the form itself refuses a
  // second one.
  renderLinks('Bob Baker', 'the poster', undefined)

  expect(screen.getByRole('link', { name: 'Leave a Review for Bob' })).toBeTruthy()
})

test('a missing name falls back to the wording the page passes in', () => {
  renderLinks('', 'the recipient', false)

  expect(screen.getByRole('link', { name: 'Leave a Review for the recipient' })).toBeTruthy()

  cleanup()
  renderLinks(undefined, 'the poster', false)
  expect(screen.getByRole('link', { name: 'Leave a Review for the poster' })).toBeTruthy()
})

test('always offers the read-both-sides link next to it', () => {
  renderLinks('Bob Baker', 'the poster', true)

  const viewLink = screen.getByRole('link', { name: 'View Reviews' })
  expect(viewLink.getAttribute('href')).toBe('/exchange-reviews?claim=claim-1')
})

test('both links share the styling, default or passed in', () => {
  renderLinks('Bob Baker', 'the poster', false)

  const defaultReviewLink = screen.getByRole('link', { name: 'Leave a Review for Bob' })
  const defaultViewLink = screen.getByRole('link', { name: 'View Reviews' })
  expect(defaultReviewLink.className).toBe(defaultViewLink.className)
  expect(defaultReviewLink.className).toContain('border-primary-200')

  // A page with its own button variant passes it in, and both links take it.
  cleanup()
  renderLinks('Bob Baker', 'the poster', false, 'my-own-classes')
  expect(
    screen.getByRole('link', { name: 'Leave a Review for Bob' }).className,
  ).toBe('my-own-classes')
  expect(screen.getByRole('link', { name: 'View Reviews' }).className).toBe('my-own-classes')
})

// ── the delete button (Rule 4) ────────────────────────────────────────────────

test('offers no delete button until the caller has written a review', () => {
  renderLinks('Bob Baker', 'the poster', false)
  expect(screen.queryByRole('button', { name: 'Delete My Review' })).toBeNull()

  cleanup()
  renderLinks('Bob Baker', 'the poster', undefined)
  expect(screen.queryByRole('button', { name: 'Delete My Review' })).toBeNull()
})

test('shows the delete button once the caller has a review, in the red style', () => {
  renderLinks('Bob Baker', 'the poster', true)

  const deleteButton = screen.getByRole('button', { name: 'Delete My Review' })
  expect(deleteButton.className).toContain('text-error')
  expect(deleteButton.className).toContain('border-red-200')
})

test('the delete button keeps its own red style even with a page variant', () => {
  renderLinks('Bob Baker', 'the poster', true, 'my-own-classes')

  const deleteButton = screen.getByRole('button', { name: 'Delete My Review' })
  expect(deleteButton.className).toContain('text-error')
  expect(deleteButton.className).not.toBe('my-own-classes')
})

test('saying no at the confirm dialog sends nothing', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  let fetchCallCount = 0
  vi.stubGlobal('fetch', async () => {
    fetchCallCount = fetchCallCount + 1
    return makeFakeResponse(true, 204, '')
  })
  vi.stubGlobal('confirm', () => false)
  let deletedCallCount = 0

  renderLinks('Bob Baker', 'the poster', true, undefined, () => {
    deletedCallCount = deletedCallCount + 1
  })
  fireEvent.click(screen.getByRole('button', { name: 'Delete My Review' }))

  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Delete My Review' })).toBeTruthy(),
  )
  expect(fetchCallCount).toBe(0)
  expect(deletedCallCount).toBe(0)
})

test('confirming sends one DELETE for this claim and tells the page', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  let requestUrl = ''
  let requestMethod = ''
  let requestHeaders = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    requestUrl = String(url)
    if (options !== undefined) {
      requestMethod = String(options.method)
      requestHeaders = JSON.stringify(options.headers)
    }
    return makeFakeResponse(true, 204, '')
  })
  vi.stubGlobal('confirm', () => true)
  let deletedCallCount = 0

  renderLinks('Bob Baker', 'the poster', true, undefined, () => {
    deletedCallCount = deletedCallCount + 1
  })
  fireEvent.click(screen.getByRole('button', { name: 'Delete My Review' }))

  await waitFor(() => expect(deletedCallCount).toBe(1))
  expect(requestUrl).toBe('/api/claims/claim-1/review')
  expect(requestMethod).toBe('DELETE')
  expect(requestHeaders).toContain('member-1')
})

test('a double click sends one request, and a repeat delete still succeeds', async () => {
  // The first two clicks land in the same tick, so the in-flight guard lets
  // only one through. A later click is a fresh delete, which the backend
  // answers with another 204 because the review is already gone.
  window.localStorage.setItem('memberId', 'member-1')
  let deleteCallCount = 0
  vi.stubGlobal('fetch', async () => {
    deleteCallCount = deleteCallCount + 1
    return makeFakeResponse(true, 204, '')
  })
  vi.stubGlobal('confirm', () => true)
  let deletedCallCount = 0

  renderLinks('Bob Baker', 'the poster', true, undefined, () => {
    deletedCallCount = deletedCallCount + 1
  })
  const deleteButton = screen.getByRole('button', { name: 'Delete My Review' })
  fireEvent.click(deleteButton)
  fireEvent.click(deleteButton)

  await waitFor(() => expect(deletedCallCount).toBe(1))
  expect(deleteCallCount).toBe(1)

  fireEvent.click(screen.getByRole('button', { name: 'Delete My Review' }))
  await waitFor(() => expect(deletedCallCount).toBe(2))
  expect(deleteCallCount).toBe(2)
  expect(screen.queryByRole('alert')).toBeNull()
})

test('a refused delete shows the server sentence and leaves the button', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  const refusal = { detail: 'An administrator disabled your review for this exchange.' }
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 403, JSON.stringify(refusal)))
  vi.stubGlobal('confirm', () => true)
  let deletedCallCount = 0

  renderLinks('Bob Baker', 'the poster', true, undefined, () => {
    deletedCallCount = deletedCallCount + 1
  })
  fireEvent.click(screen.getByRole('button', { name: 'Delete My Review' }))

  await waitFor(() => screen.getByRole('alert'))
  expect(screen.getByRole('alert').textContent).toContain('An administrator disabled')
  expect(deletedCallCount).toBe(0)
  expect(screen.getByRole('button', { name: 'Delete My Review' })).toBeTruthy()
})

test('a network failure on delete shows the error message', async () => {
  window.localStorage.setItem('memberId', 'member-1')
  vi.stubGlobal('fetch', async () => {
    throw new Error('network down')
  })
  vi.stubGlobal('confirm', () => true)

  renderLinks('Bob Baker', 'the poster', true)
  fireEvent.click(screen.getByRole('button', { name: 'Delete My Review' }))

  await waitFor(() => screen.getByRole('alert'))
  expect(screen.getByRole('alert').textContent).toContain('Request failed')
})
