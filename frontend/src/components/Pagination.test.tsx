// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import Pagination from './Pagination'

afterEach(() => {
  cleanup()
})

// Render the control with sensible defaults, so each test only names what it
// cares about.
function renderPagination(overrides: {
  page?: number
  pageSize?: number
  total?: number
  onPageChange?: (nextPage: number) => void
  label?: string
}) {
  const props = {
    page: overrides.page ?? 1,
    pageSize: overrides.pageSize ?? 12,
    total: overrides.total ?? 40,
    onPageChange: overrides.onPageChange ?? (() => {}),
    label: overrides.label ?? 'Listings',
  }
  render(<Pagination {...props} />)
  return props
}

// --- Scenario 4 and 5: nothing to page through means no controls ---

test('renders nothing when the total fits on one page', () => {
  renderPagination({ page: 1, pageSize: 12, total: 12 })

  expect(screen.queryByRole('navigation')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Next' })).toBeNull()
})

test('renders nothing when the total is below the page size', () => {
  renderPagination({ page: 1, pageSize: 12, total: 3 })

  expect(screen.queryByRole('navigation')).toBeNull()
})

test('renders nothing for an empty list', () => {
  renderPagination({ page: 1, pageSize: 12, total: 0 })

  expect(screen.queryByRole('navigation')).toBeNull()
})

// --- the count line ---

test('shows the window and the total on the first page', () => {
  renderPagination({ page: 1, pageSize: 12, total: 40 })

  expect(screen.getByText('Showing 1-12 of 40')).toBeTruthy()
})

test('shows the window for a later page', () => {
  renderPagination({ page: 2, pageSize: 12, total: 40 })

  expect(screen.getByText('Showing 13-24 of 40')).toBeTruthy()
})

test('the last page stops counting at the total', () => {
  renderPagination({ page: 4, pageSize: 12, total: 40 })

  expect(screen.getByText('Showing 37-40 of 40')).toBeTruthy()
})

// --- Scenario 1 and 9: the bounds ---

test('Prev is disabled and Next is enabled on the first page', () => {
  renderPagination({ page: 1, pageSize: 12, total: 40 })

  const previousButton = screen.getByRole('button', { name: 'Prev' }) as HTMLButtonElement
  const nextButton = screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement
  expect(previousButton.disabled).toBe(true)
  expect(nextButton.disabled).toBe(false)
})

test('Next is disabled and Prev is enabled on the last page', () => {
  renderPagination({ page: 4, pageSize: 12, total: 40 })

  const previousButton = screen.getByRole('button', { name: 'Prev' }) as HTMLButtonElement
  const nextButton = screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement
  expect(previousButton.disabled).toBe(false)
  expect(nextButton.disabled).toBe(true)
})

test('both are enabled in the middle of the list', () => {
  renderPagination({ page: 2, pageSize: 12, total: 40 })

  const previousButton = screen.getByRole('button', { name: 'Prev' }) as HTMLButtonElement
  const nextButton = screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement
  expect(previousButton.disabled).toBe(false)
  expect(nextButton.disabled).toBe(false)
})

// --- onPageChange ---

test('Next asks for the following page', () => {
  const onPageChange = vi.fn()
  renderPagination({ page: 2, pageSize: 12, total: 40, onPageChange: onPageChange })

  fireEvent.click(screen.getByRole('button', { name: 'Next' }))

  expect(onPageChange).toHaveBeenCalledWith(3)
})

test('Prev asks for the previous page', () => {
  const onPageChange = vi.fn()
  renderPagination({ page: 3, pageSize: 12, total: 40, onPageChange: onPageChange })

  fireEvent.click(screen.getByRole('button', { name: 'Prev' }))

  expect(onPageChange).toHaveBeenCalledWith(2)
})

test('a numbered button asks for that exact page', () => {
  const onPageChange = vi.fn()
  renderPagination({ page: 1, pageSize: 12, total: 40, onPageChange: onPageChange })

  fireEvent.click(screen.getByRole('button', { name: 'Page 3' }))

  expect(onPageChange).toHaveBeenCalledWith(3)
})

test('the control reports the click and changes nothing itself', () => {
  // It is presentational: the page that renders it owns the URL, so a click
  // must not move the control on its own.
  const onPageChange = vi.fn()
  renderPagination({ page: 1, pageSize: 12, total: 40, onPageChange: onPageChange })

  fireEvent.click(screen.getByRole('button', { name: 'Next' }))

  expect(screen.getByText('Showing 1-12 of 40')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Page 1' }).getAttribute('aria-current')).toBe('page')
})

// --- Scenario 9: accessibility ---

test('the control is a nav named after its list', () => {
  renderPagination({ page: 1, pageSize: 12, total: 40, label: 'Pending requests' })

  expect(screen.getByRole('navigation', { name: 'Pending requests pagination' })).toBeTruthy()
})

test('only the current page is marked as current', () => {
  renderPagination({ page: 2, pageSize: 12, total: 40 })

  expect(screen.getByRole('button', { name: 'Page 2' }).getAttribute('aria-current')).toBe('page')
  expect(screen.getByRole('button', { name: 'Page 1' }).getAttribute('aria-current')).toBeNull()
  expect(screen.getByRole('button', { name: 'Page 3' }).getAttribute('aria-current')).toBeNull()
})

// --- the numbered buttons and the ellipsis ---

test('every page gets a button when the list is short', () => {
  renderPagination({ page: 1, pageSize: 12, total: 40 })

  expect(screen.getByRole('button', { name: 'Page 1' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Page 4' })).toBeTruthy()
  // Four pages, so no run of pages is left out.
  expect(screen.queryByText('…')).toBeNull()
})

test('a long list is abbreviated with an ellipsis around the current page', () => {
  // 240 rows at 12 a page is 20 pages, far more than fit on one row.
  renderPagination({ page: 10, pageSize: 12, total: 240 })

  expect(screen.getByRole('button', { name: 'Page 1' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Page 9' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Page 10' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Page 11' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Page 20' })).toBeTruthy()
  // The pages between are left out rather than drawn.
  expect(screen.queryByRole('button', { name: 'Page 5' })).toBeNull()
  expect(screen.getAllByText('…').length).toBe(2)
})

test('the ellipsis is hidden from screen readers', () => {
  renderPagination({ page: 10, pageSize: 12, total: 240 })

  const gaps = screen.getAllByText('…')
  expect(gaps[0].getAttribute('aria-hidden')).toBe('true')
})
