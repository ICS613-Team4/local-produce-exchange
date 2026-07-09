// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import BrowsePage from './BrowsePage'

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

function makeFakeResponse(ok: boolean, status: number, body: object): FakeResponse {
  const bodyText = JSON.stringify(body)
  const fakeResponse = {
    ok: ok,
    status: status,
    text: async () => {
      return bodyText
    },
  }
  return fakeResponse
}

// One listing in the shape the backend returns, so the cards render.
function makeListing(id: string, title: string) {
  const listing = {
    id: id,
    owner_id: 'member-999',
    title: title,
    description: 'A description.',
    category: 'Fruit',
    total_quantity: 5,
    remaining_quantity: 5,
    dietary_tags: ['vegan'],
    allergen_tags: [],
    pickup_start: '2026-07-01T09:00:00.000Z',
    pickup_end: '2026-07-01T11:00:00.000Z',
    status: 'active',
    created_at: '2026-06-19T00:00:00.000Z',
  }
  return listing
}

// Render the browse page with routes for /browse and /login, so the redirect
// guard has somewhere to land.
function renderBrowse() {
  render(
    <MemoryRouter initialEntries={['/browse']}>
      <Routes>
        <Route path="/browse" element={<BrowsePage />} />
        <Route path="/login" element={<p>Login page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('redirects to the login page when not logged in', () => {
  // No memberId in localStorage, so the page must send the visitor to /login.
  renderBrowse()

  expect(screen.getByText('Login page')).toBeTruthy()
})

test('renders the controls and lists the active listings on open', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  const listings = [makeListing('l1', 'Backyard Meyer Lemons')]
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, listings)
  })

  renderBrowse()

  // The search box, category select, and tag checkboxes all render.
  expect(screen.getByLabelText('Search')).toBeTruthy()
  expect(screen.getByLabelText('Category')).toBeTruthy()
  expect(screen.getByLabelText('vegan')).toBeTruthy()
  expect(screen.getByLabelText('contains nuts')).toBeTruthy()

  // The listing title shows after the open load, linking to its detail page.
  const titleLink = await screen.findByRole('link', { name: 'Backyard Meyer Lemons' })
  expect(titleLink.getAttribute('href')).toBe('/listings/l1')

  // Each card shows the date the listing was posted, in the viewer's local zone.
  // Build the expected text the same way the page does, so this passes on any
  // machine's locale or time zone.
  const timeZoneOptions = { timeZoneName: 'short' as const }
  const postedExpected = new Date('2026-06-19T00:00:00.000Z').toLocaleString(undefined, timeZoneOptions)
  expect(screen.getByText('Posted ' + postedExpected)).toBeTruthy()

  // The local time-zone note shows under each card's pickup time.
  expect(screen.getByText(/All times are shown in your local time zone/)).toBeTruthy()
})

test('shows the empty message when nothing matches', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, [])
  })

  renderBrowse()

  expect(await screen.findByText('No listings match your search.')).toBeTruthy()
})

test('submits the search text, category, and repeated tag params', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  let lastUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    lastUrl = String(url)
    return makeFakeResponse(true, 200, [])
  })

  renderBrowse()
  // Wait for the open load to finish before changing the controls.
  await screen.findByText('No listings match your search.')

  fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'lemon' } })
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Fruit' } })
  fireEvent.click(screen.getByLabelText('vegan'))
  fireEvent.click(screen.getByLabelText('contains nuts'))
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

  await waitFor(() => {
    expect(lastUrl).toContain('q=lemon')
  })
  expect(lastUrl).toContain('category=Fruit')
  expect(lastUrl).toContain('dietary_tags=vegan')
  expect(lastUrl).toContain('allergen_tags=contains+nuts')
})

test('Clear resets the controls and reloads the full list', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  let lastUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    lastUrl = String(url)
    return makeFakeResponse(true, 200, [])
  })

  renderBrowse()
  await screen.findByText('No listings match your search.')

  const searchInput = screen.getByLabelText('Search') as HTMLInputElement
  fireEvent.change(searchInput, { target: { value: 'lemon' } })
  fireEvent.click(screen.getByLabelText('vegan'))
  expect(searchInput.value).toBe('lemon')

  fireEvent.click(screen.getByRole('button', { name: 'Clear' }))

  // The text box is emptied and the checkbox is unchecked.
  expect(searchInput.value).toBe('')
  const veganCheckbox = screen.getByLabelText('vegan') as HTMLInputElement
  expect(veganCheckbox.checked).toBe(false)
  // The reload asks for the plain list with no query string.
  await waitFor(() => {
    expect(lastUrl.endsWith('/api/listings')).toBe(true)
  })
})

test('shows the error state when the request fails', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  const errorBody = { detail: 'Could not read listings right now.' }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 503, errorBody)
  })

  renderBrowse()

  expect(await screen.findByText('Could not read listings right now.')).toBeTruthy()
})

test('shows the transport error message when the request times out', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  renderBrowse()

  // The service turns a timeout into an errorMessage, which the page shows.
  expect(await screen.findByText(/Timeout: no answer from the backend/)).toBeTruthy()
})

test('renders a card for a listing that has no dietary tags', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  const listing = makeListing('l9', 'No Diet Tags')
  listing.dietary_tags = []
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, [listing])
  })

  renderBrowse()

  // The card still renders with an empty dietary list, which shows as "None".
  expect(await screen.findByRole('link', { name: 'No Diet Tags' })).toBeTruthy()
})

test('checking two tags then unchecking one keeps only the remaining tag', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  let lastUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    lastUrl = String(url)
    return makeFakeResponse(true, 200, [])
  })

  renderBrowse()
  await screen.findByText('No listings match your search.')

  // Check two dietary tags, then uncheck the first.
  fireEvent.click(screen.getByLabelText('vegan'))
  fireEvent.click(screen.getByLabelText('gluten-free'))
  fireEvent.click(screen.getByLabelText('vegan'))
  // Check two allergen tags.
  fireEvent.click(screen.getByLabelText('contains wheat'))
  fireEvent.click(screen.getByLabelText('contains nuts'))
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

  await waitFor(() => {
    expect(lastUrl).toContain('dietary_tags=gluten-free')
  })
  // vegan was unchecked, so it is not in the query.
  expect(lastUrl).not.toContain('dietary_tags=vegan')
  expect(lastUrl).toContain('allergen_tags=contains+wheat')
  expect(lastUrl).toContain('allergen_tags=contains+nuts')
})
