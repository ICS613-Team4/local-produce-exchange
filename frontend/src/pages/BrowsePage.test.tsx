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

// Wrap listings in the paged envelope the backend answers with, so the stubs
// return the shape the page really reads. page and page_size default to the
// first page of twelve, and total defaults to "they all fit", which is what
// keeps the controls out of the tests that are not about paging.
function makePage(
  items: object[],
  total?: number,
  page?: number,
  pageSize?: number,
) {
  const resolvedPageSize = pageSize ?? 12
  return {
    items: items,
    total: total ?? items.length,
    page: page ?? 1,
    page_size: resolvedPageSize,
  }
}

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
    owner_name: 'Olivia Owner',
    photos: [] as Array<{ id: string; content_type: string; position: number }>,
    // The owner's listing-owner rating (US-20). null and 0 read as
    // "(no listing owner rating)"; a test that needs a rated owner
    // overwrites these.
    owner_rating_average: null as number | null,
    owner_rating_count: 0,
  }
  return listing
}

// Render the browse page on its own route.
function renderBrowse() {
  render(
    <MemoryRouter initialEntries={['/browse']}>
      <Routes>
        <Route path="/browse" element={<BrowsePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

test('renders the controls and lists the active listings on open', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  const listings = [makeListing('l1', 'Backyard Meyer Lemons')]
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makePage(listings))
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

  // Each card names who posted the listing on one line and the posted time on
  // the next line, in the viewer's local zone. Build the expected time the
  // same way the page does, so this passes on any machine's locale or zone.
  const timeZoneOptions = { timeZoneName: 'short' as const }
  const postedExpected = new Date('2026-06-19T00:00:00.000Z').toLocaleString(undefined, timeZoneOptions)
  expect(screen.getByText('Posted by Olivia Owner')).toBeTruthy()
  expect(screen.getByText(postedExpected)).toBeTruthy()

  // The local time-zone note shows under each card's pickup time.
  expect(screen.getByText(/All times are shown in your local time zone/)).toBeTruthy()
})

test('shows the empty message when nothing matches', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makePage([]))
  })

  renderBrowse()

  expect(await screen.findByText('No listings match your search.')).toBeTruthy()
})

test('renders the first listing photo as the card cover', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  const listing = makeListing('l1', 'Backyard Meyer Lemons')
  listing.photos = [
    { id: 'cover-photo', content_type: 'image/webp', position: 0 },
  ]
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makePage([listing]))
  })

  renderBrowse()

  const image = await screen.findByRole('img', { name: 'Backyard Meyer Lemons' })
  expect(image.getAttribute('src')).toBe('/api/photos/cover-photo')
})

test('submits the search text, category, and repeated tag params', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  let lastUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    lastUrl = String(url)
    return makeFakeResponse(true, 200, makePage([]))
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
    return makeFakeResponse(true, 200, makePage([]))
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
  // The reload asks for the unfiltered list, back on page 1.
  await waitFor(() => {
    expect(lastUrl).toContain('page=1')
  })
  expect(lastUrl).not.toContain('q=')
  expect(lastUrl).not.toContain('dietary_tags=')
})

// --- US-33: paging the browse results ---

// Twelve listings, so a total above twelve means a second page exists.
function makeFullPageOfListings() {
  const listings = []
  for (let index = 0; index < 12; index = index + 1) {
    listings.push(makeListing('l' + index, 'Listing ' + index))
  }
  return listings
}

test('shows the count and the controls when there is more than one page', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makePage(makeFullPageOfListings(), 40, 1, 12))
  })

  renderBrowse()

  // Scenario 1: the first window renders, the count names it, Prev is disabled
  // and Next is not.
  await screen.findByRole('link', { name: 'Listing 0' })
  expect(screen.getByText('Showing 1-12 of 40')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Prev' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false)
})

test('no controls appear when every match fits on one page', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makePage([makeListing('l1', 'Only One')], 1, 1, 12))
  })

  renderBrowse()

  // Scenario 4.
  await screen.findByRole('link', { name: 'Only One' })
  expect(screen.queryByRole('navigation', { name: 'Listings pagination' })).toBeNull()
})

test('no controls appear on the empty state', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makePage([], 0, 1, 12))
  })

  renderBrowse()

  // Scenario 5: the existing empty state, and nothing else.
  await screen.findByText('No listings match your search.')
  expect(screen.queryByRole('navigation', { name: 'Listings pagination' })).toBeNull()
})

test('the first load asks for page 1 of twelve', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  let lastUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    lastUrl = String(url)
    return makeFakeResponse(true, 200, makePage([], 0, 1, 12))
  })

  renderBrowse()

  await waitFor(() => {
    expect(lastUrl).toContain('page=1')
  })
  expect(lastUrl).toContain('page_size=12')
})

test('Next moves to the following page and puts it in the URL', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  let lastUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    lastUrl = String(url)
    const requestedPage = String(url).includes('page=2') ? 2 : 1
    return makeFakeResponse(true, 200, makePage(makeFullPageOfListings(), 40, requestedPage, 12))
  })

  renderBrowse()
  await screen.findByText('Showing 1-12 of 40')

  fireEvent.click(screen.getByRole('button', { name: 'Next' }))

  // Scenario 1: the next window is fetched and the count follows it.
  await waitFor(() => {
    expect(lastUrl).toContain('page=2')
  })
  expect(await screen.findByText('Showing 13-24 of 40')).toBeTruthy()
})

test('opening ?page=3 renders page 3 and marks it as current', async () => {
  // Scenario 2: a deep link.
  window.localStorage.setItem('memberId', 'member-123')
  let lastUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    lastUrl = String(url)
    return makeFakeResponse(true, 200, makePage(makeFullPageOfListings(), 40, 3, 12))
  })

  render(
    <MemoryRouter initialEntries={['/browse?page=3']}>
      <Routes>
        <Route path="/browse" element={<BrowsePage />} />
      </Routes>
    </MemoryRouter>,
  )

  await screen.findByText('Showing 25-36 of 40')
  expect(lastUrl).toContain('page=3')
  expect(screen.getByRole('button', { name: 'Page 3' }).getAttribute('aria-current')).toBe('page')
})

test('a non-numeric page in the URL is treated as page 1', async () => {
  // Scenario 10, the frontend half: a hand-edited URL must not become a bad
  // request; it reads as the first page.
  window.localStorage.setItem('memberId', 'member-123')
  let lastUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    lastUrl = String(url)
    return makeFakeResponse(true, 200, makePage([], 0, 1, 12))
  })

  render(
    <MemoryRouter initialEntries={['/browse?page=abc']}>
      <Routes>
        <Route path="/browse" element={<BrowsePage />} />
      </Routes>
    </MemoryRouter>,
  )

  await waitFor(() => {
    expect(lastUrl).toContain('page=1')
  })
})

test('a page past the end falls back to the last page', async () => {
  // Scenario 6: the backend answers an out-of-range page with an empty window
  // and the true total; the page clamps and shows the last real page.
  window.localStorage.setItem('memberId', 'member-123')
  const requestedPages: number[] = []
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    const pageMatch = urlText.match(/page=(\d+)/)
    const requestedPage = pageMatch === null ? 1 : Number(pageMatch[1])
    requestedPages.push(requestedPage)
    if (requestedPage > 2) {
      return makeFakeResponse(true, 200, makePage([], 20, requestedPage, 12))
    }
    return makeFakeResponse(true, 200, makePage(makeFullPageOfListings(), 20, requestedPage, 12))
  })

  render(
    <MemoryRouter initialEntries={['/browse?page=9']}>
      <Routes>
        <Route path="/browse" element={<BrowsePage />} />
      </Routes>
    </MemoryRouter>,
  )

  // 20 rows at 12 a page is 2 pages, so page 9 lands on page 2.
  expect(await screen.findByText('Showing 13-20 of 20')).toBeTruthy()
  expect(requestedPages).toContain(9)
  expect(requestedPages).toContain(2)
})

test('applying a filter resets to page 1 and keeps the filter in the URL', async () => {
  // Scenario 3.
  window.localStorage.setItem('memberId', 'member-123')
  let lastUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    lastUrl = String(url)
    return makeFakeResponse(true, 200, makePage(makeFullPageOfListings(), 40, 3, 12))
  })

  render(
    <MemoryRouter initialEntries={['/browse?page=3']}>
      <Routes>
        <Route path="/browse" element={<BrowsePage />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByText('Showing 25-36 of 40')

  fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'lemon' } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

  await waitFor(() => {
    expect(lastUrl).toContain('q=lemon')
  })
  // The new filter and page 1 travel together: page 3 of the old list means
  // nothing in the filtered one.
  expect(lastUrl).toContain('page=1')
  expect(lastUrl).not.toContain('page=3')
})

test('paging keeps the filters that are already applied', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  let lastUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    lastUrl = String(url)
    return makeFakeResponse(true, 200, makePage(makeFullPageOfListings(), 40, 1, 12))
  })

  render(
    <MemoryRouter initialEntries={['/browse?q=lemon&category=Fruit&page=1']}>
      <Routes>
        <Route path="/browse" element={<BrowsePage />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findByText('Showing 1-12 of 40')

  fireEvent.click(screen.getByRole('button', { name: 'Next' }))

  await waitFor(() => {
    expect(lastUrl).toContain('page=2')
  })
  expect(lastUrl).toContain('q=lemon')
  expect(lastUrl).toContain('category=Fruit')
})

test('filters in the URL are shown in the form controls', async () => {
  // The filters live in the URL, so a deep link fills the boxes too and the
  // back button restores what the member had typed.
  window.localStorage.setItem('memberId', 'member-123')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makePage([], 0, 1, 12))
  })

  render(
    <MemoryRouter initialEntries={['/browse?q=lemon&category=Fruit&dietary_tags=vegan']}>
      <Routes>
        <Route path="/browse" element={<BrowsePage />} />
      </Routes>
    </MemoryRouter>,
  )

  await screen.findByText('No listings match your search.')
  expect((screen.getByLabelText('Search') as HTMLInputElement).value).toBe('lemon')
  expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe('Fruit')
  expect((screen.getByLabelText('vegan') as HTMLInputElement).checked).toBe(true)
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
    return makeFakeResponse(true, 200, makePage([listing]))
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
    return makeFakeResponse(true, 200, makePage([]))
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

// --- US-20: each card shows the owner's listing-owner rating ---

test('a card shows the owner rating chip when the owner has reviews', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  const listing = makeListing('l1', 'Rated Lemons')
  listing.owner_rating_average = 4.0
  listing.owner_rating_count = 1
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makePage([listing]))
  })

  renderBrowse()

  await screen.findByRole('link', { name: 'Rated Lemons' })
  // The rating sits inline in the posted-by line itself, with no count shown.
  const chip = screen.getByRole('link', {
    name: "View the reviews behind this member's rating as a listing owner",
  })
  expect(chip.textContent).toBe('(★ 4.0 listing owner rating)')
  const postedLine = screen.getByText('Posted by Olivia Owner')
  expect(postedLine.contains(chip)).toBe(true)
})

test('a card says no rating, without a link, for an unrated owner', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, makePage([makeListing('l1', 'Unrated Kale')]))
  })

  renderBrowse()

  await screen.findByRole('link', { name: 'Unrated Kale' })
  // No reviews renders plain non-clickable text: no star, no chip button.
  expect(screen.getByText('Posted by Olivia Owner')).toBeTruthy()
  expect(screen.getByText('(no listing owner rating)')).toBeTruthy()
  expect(screen.queryByText(/★/)).toBeNull()
  expect(screen.queryByRole('link', { name: /View the reviews/ })).toBeNull()
})
