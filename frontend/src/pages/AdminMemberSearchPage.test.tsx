// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import AdminMemberSearchPage from './AdminMemberSearchPage'

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

function makeFakeResponse(ok: boolean, status: number, body: unknown): FakeResponse {
  const bodyText = JSON.stringify(body)
  return { ok, status, text: async () => bodyText }
}

function renderSearchPage() {
  window.localStorage.setItem('memberId', 'admin-1')
  render(
    <MemoryRouter>
      <AdminMemberSearchPage />
    </MemoryRouter>,
  )
}

function runSearch(searchText: string) {
  fireEvent.change(screen.getByLabelText('Name or email'), { target: { value: searchText } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
}

test('shows nothing before a search has run', () => {
  renderSearchPage()

  expect(screen.queryByText(/No members match/)).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

test('shows matching members with their name, email, and status', async () => {
  vi.stubGlobal('fetch', async () =>
    makeFakeResponse(true, 200, [
      { id: 'member-2', name: 'Carol Chen', email: 'carol@example.com', status: 'active' },
    ]),
  )

  renderSearchPage()
  runSearch('carol')

  const nameLink = await screen.findByRole('link', { name: 'Carol Chen' })
  expect(nameLink.getAttribute('href')).toBe('/admin/members/member-2')
  expect(screen.getByText('carol@example.com')).toBeTruthy()
  expect(screen.getByText('active')).toBeTruthy()
})

test('shows an empty-result message when nothing matches', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, []))

  renderSearchPage()
  runSearch('nobody')

  expect(await screen.findByText('No members match that search.')).toBeTruthy()
})

test('shows a suspended member with a distinct status badge', async () => {
  vi.stubGlobal('fetch', async () =>
    makeFakeResponse(true, 200, [
      { id: 'member-3', name: 'Suspended Sam', email: 'sam@example.com', status: 'suspended' },
    ]),
  )

  renderSearchPage()
  runSearch('sam')

  expect(await screen.findByText('suspended')).toBeTruthy()
})

test('shows an error message when the search request fails', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(false, 503, { detail: 'Service unavailable.' }))

  renderSearchPage()
  runSearch('carol')

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toContain('Service unavailable.')
})

test('shows an error message on a network failure (transport error, not an HTTP status)', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('Network unreachable')
  })

  renderSearchPage()
  runSearch('carol')

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toContain('Request failed')
})

test('shows an inactive member with the neutral fallback badge', async () => {
  vi.stubGlobal('fetch', async () =>
    makeFakeResponse(true, 200, [
      { id: 'member-4', name: 'Inactive Ian', email: 'ian@example.com', status: 'inactive' },
    ]),
  )

  renderSearchPage()
  runSearch('ian')

  expect(await screen.findByText('inactive')).toBeTruthy()
})
