// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import MyListingsPage from './MyListingsPage'

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

// Builds one listing row body in the shape the my-listings endpoint returns.
function makeListing(id: string, title: string, status: string, deactivatedBy: string | null) {
  const listing = {
    id: id,
    owner_id: 'me',
    title: title,
    description: 'A description.',
    category: 'Fruit',
    total_quantity: 5,
    remaining_quantity: 5,
    dietary_tags: [],
    allergen_tags: [],
    pickup_start: '2026-07-01T09:00:00.000Z',
    pickup_end: '2026-07-01T11:00:00.000Z',
    status: status,
    created_at: '2026-06-19T00:00:00.000Z',
    deactivated_by: deactivatedBy,
  }
  return listing
}

// The page loads /api/my-listings on mount. This stubs that fetch so a test can
// shape the response.
function stubMyListings(handle: () => FakeResponse) {
  vi.stubGlobal('fetch', async () => {
    return handle()
  })
}

function renderMyListings() {
  render(
    <MemoryRouter initialEntries={['/my-listings']}>
      <Routes>
        <Route path="/my-listings" element={<MyListingsPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function setLoggedIn() {
  window.localStorage.setItem('memberId', 'me')
  window.localStorage.setItem('memberName', 'Me')
}

async function waitForStateUpdates() {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

test('shows the loading message before the listings arrive', () => {
  setLoggedIn()
  // A fetch that never resolves keeps the page in its loading state.
  vi.stubGlobal('fetch', () => {
    return new Promise(() => {})
  })

  renderMyListings()

  expect(screen.getByText('Loading your listings...')).toBeTruthy()
})

test('renders owned listings in the returned order', async () => {
  setLoggedIn()
  const listings = [
    makeListing('a', 'Apple', 'active', null),
    makeListing('b', 'Banana', 'deactivated', null),
  ]
  stubMyListings(() => makeFakeResponse(true, 200, listings))

  renderMyListings()

  expect(await screen.findByText(/Apple/)).toBeTruthy()
  const items = screen.getAllByRole('listitem')
  // The backend order is kept: Apple first, then Banana.
  expect(items[0].textContent).toContain('Apple')
  expect(items[1].textContent).toContain('Banana')
})

test('a row with photos shows the first photo as a thumbnail', async () => {
  setLoggedIn()
  const withPhotos = makeListing('a', 'Apple', 'active', null) as ReturnType<typeof makeListing> & {
    photos?: Array<{ id: string; content_type: string; position: number }>
  }
  withPhotos.photos = [
    { id: 'photo-first', content_type: 'image/png', position: 0 },
    { id: 'photo-second', content_type: 'image/png', position: 1 },
  ]
  stubMyListings(() => makeFakeResponse(true, 200, [withPhotos]))

  renderMyListings()

  const image = await screen.findByRole('img', { name: 'Apple' })
  // Only the first photo shows, even when the listing has more than one.
  expect(image.getAttribute('src')).toBe('/api/photos/photo-first')
  expect(screen.getAllByRole('img').length).toBe(1)
})

test('a row without photos shows no thumbnail image', async () => {
  setLoggedIn()
  stubMyListings(() => makeFakeResponse(true, 200, [makeListing('a', 'Apple', 'active', null)]))

  renderMyListings()

  expect(await screen.findByText(/Apple/)).toBeTruthy()
  expect(screen.queryByRole('img')).toBeNull()
})

test('an active row shows edit, an enabled deactivate, a disabled activate, and a title link', async () => {
  setLoggedIn()
  stubMyListings(() => makeFakeResponse(true, 200, [makeListing('a', 'Apple', 'active', null)]))

  renderMyListings()

  const titleLink = await screen.findByRole('link', { name: 'Apple' })
  expect(titleLink.getAttribute('href')).toBe('/listings/a')

  const editLink = screen.getByRole('link', { name: 'Edit' })
  expect(editLink.getAttribute('href')).toBe('/listings/a/edit')

  const deactivateButton = screen.getByRole('button', { name: 'Deactivate' })
  expect((deactivateButton as HTMLButtonElement).disabled).toBe(false)

  const activateButton = screen.getByRole('button', { name: 'Activate listing' })
  expect((activateButton as HTMLButtonElement).disabled).toBe(true)
})

test('an owner-deactivated row shows no edit, a plain title, an enabled Activate, and a disabled Deactivate', async () => {
  setLoggedIn()
  stubMyListings(() => makeFakeResponse(true, 200, [makeListing('b', 'Banana', 'deactivated', null)]))

  renderMyListings()

  expect(await screen.findByText(/Banana/)).toBeTruthy()
  // The title is plain text, not a link, for a non-active listing.
  expect(screen.queryByRole('link', { name: 'Banana' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull()

  // The owner can act on their own deactivated listing, so Activate is enabled.
  // Deactivate stays disabled because the listing is already deactivated.
  const activateButton = screen.getByRole('button', { name: 'Activate listing' })
  const deactivateButton = screen.getByRole('button', { name: 'Deactivate listing' })
  expect((activateButton as HTMLButtonElement).disabled).toBe(false)
  expect((deactivateButton as HTMLButtonElement).disabled).toBe(true)
})

test('clicking Activate calls the reactivate endpoint and reloads the list', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })

  let myListingsCalls = 0
  let reactivateUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/reactivate')) {
      reactivateUrl = urlText
      return {
        ok: true,
        status: 204,
        text: async () => {
          return ''
        },
      }
    }
    myListingsCalls = myListingsCalls + 1
    if (myListingsCalls === 1) {
      return makeFakeResponse(true, 200, [makeListing('b', 'Banana', 'deactivated', null)])
    }
    return makeFakeResponse(true, 200, [makeListing('b', 'Banana', 'active', null)])
  })

  renderMyListings()

  const activateButton = await screen.findByRole('button', { name: 'Activate listing' })
  fireEvent.click(activateButton)

  const titleLink = await screen.findByRole('link', { name: 'Banana' })
  expect(titleLink.getAttribute('href')).toBe('/listings/b')
  expect(reactivateUrl).toContain('/api/listings/b/reactivate')
  expect(myListingsCalls).toBe(2)
})

test('cancelling the reactivate confirm does not call the endpoint', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return false
  })
  let reactivateCalled = false
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/reactivate')) {
      reactivateCalled = true
      return {
        ok: true,
        status: 204,
        text: async () => {
          return ''
        },
      }
    }
    return makeFakeResponse(true, 200, [makeListing('b', 'Banana', 'deactivated', null)])
  })

  renderMyListings()

  const activateButton = await screen.findByRole('button', { name: 'Activate listing' })
  fireEvent.click(activateButton)
  await waitForStateUpdates()

  expect(reactivateCalled).toBe(false)
})

test('a failed reactivate shows the server message and keeps the row deactivated', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/reactivate')) {
      return makeFakeResponse(false, 403, {
        detail: 'An administrator deactivated this listing, so you cannot reactivate it.',
      })
    }
    return makeFakeResponse(true, 200, [makeListing('b', 'Banana', 'deactivated', null)])
  })

  renderMyListings()

  const activateButton = await screen.findByRole('button', { name: 'Activate listing' })
  fireEvent.click(activateButton)

  expect(
    await screen.findByText(
      'An administrator deactivated this listing, so you cannot reactivate it.',
    ),
  ).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Banana' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Activate listing' })).toBeTruthy()
})

test('a reactivate transport error shows its message and keeps the row deactivated', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/reactivate')) {
      throw new TypeError('Failed to fetch')
    }
    return makeFakeResponse(true, 200, [makeListing('b', 'Banana', 'deactivated', null)])
  })

  renderMyListings()

  const activateButton = await screen.findByRole('button', { name: 'Activate listing' })
  fireEvent.click(activateButton)

  expect(await screen.findByText('Request failed: TypeError: Failed to fetch')).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Banana' })).toBeNull()
})

test('a 401 on reactivate clears the credentials', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/reactivate')) {
      return makeFakeResponse(false, 401, { detail: 'Not authenticated.' })
    }
    return makeFakeResponse(true, 200, [makeListing('b', 'Banana', 'deactivated', null)])
  })

  renderMyListings()

  const activateButton = await screen.findByRole('button', { name: 'Activate listing' })
  fireEvent.click(activateButton)

  // The shared route guard renders the logged-out message now, so the only
  // thing this page owns is clearing the stored login.
  await waitFor(() => {
    expect(window.localStorage.getItem('memberId')).toBeNull()
  })
})

test('an admin-deactivated row shows no edit, no buttons, and the explanation', async () => {
  setLoggedIn()
  stubMyListings(() =>
    makeFakeResponse(true, 200, [makeListing('c', 'Cherry', 'deactivated', 'admin-1')]),
  )

  renderMyListings()

  expect(await screen.findByText(/An administrator deactivated this listing/)).toBeTruthy()
  expect(screen.getByText(/Administratively deactivated/)).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Deactivate listing' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Activate listing' })).toBeNull()
})

test('clicking Deactivate calls the deactivate endpoint and reloads the list', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })

  let myListingsCalls = 0
  let deactivateUrl = ''
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/deactivate')) {
      deactivateUrl = urlText
      // The deactivate endpoint answers 204 with an empty body.
      const emptyResponse = {
        ok: true,
        status: 204,
        text: async () => {
          return ''
        },
      }
      return emptyResponse
    }
    // The /api/my-listings load: active on the first call, deactivated on the
    // reload after the deactivate succeeds.
    myListingsCalls = myListingsCalls + 1
    if (myListingsCalls === 1) {
      return makeFakeResponse(true, 200, [makeListing('a', 'Apple', 'active', null)])
    }
    return makeFakeResponse(true, 200, [makeListing('a', 'Apple', 'deactivated', null)])
  })

  renderMyListings()

  const deactivateButton = await screen.findByRole('button', { name: 'Deactivate' })
  fireEvent.click(deactivateButton)

  // After the reload, the row is deactivated: its title is no longer a link.
  await waitFor(() => {
    expect(screen.queryByRole('link', { name: 'Apple' })).toBeNull()
  })
  expect(deactivateUrl).toContain('/api/listings/a/deactivate')
  // The list loaded once on mount and once after the successful deactivate.
  expect(myListingsCalls).toBe(2)
})

test('shows the empty state when there are no listings', async () => {
  setLoggedIn()
  stubMyListings(() => makeFakeResponse(true, 200, []))

  renderMyListings()

  expect(await screen.findByText('You have not posted any listings yet.')).toBeTruthy()
})

test('shows the transport error message when the load fails', async () => {
  setLoggedIn()
  stubMyListings(() => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  renderMyListings()

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Timeout')
})

test('shows the server detail on an HTTP failure', async () => {
  setLoggedIn()
  stubMyListings(() => makeFakeResponse(false, 503, { detail: 'Could not read your listings right now.' }))

  renderMyListings()

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Could not read your listings right now.')
})

test('a failed deactivate shows the server message and keeps the row active', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/deactivate')) {
      return makeFakeResponse(false, 403, { detail: 'You can only deactivate your own listing.' })
    }
    return makeFakeResponse(true, 200, [makeListing('a', 'Apple', 'active', null)])
  })

  renderMyListings()

  const deactivateButton = await screen.findByRole('button', { name: 'Deactivate' })
  fireEvent.click(deactivateButton)

  // The failure shows as an alert, and the row stays active (its title is a link).
  expect(await screen.findByText('You can only deactivate your own listing.')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Apple' })).toBeTruthy()
})

test('cancelling the deactivate confirm does not call the endpoint', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return false
  })
  let deactivateCalled = false
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/deactivate')) {
      deactivateCalled = true
      const emptyResponse = {
        ok: true,
        status: 204,
        text: async () => {
          return ''
        },
      }
      return emptyResponse
    }
    return makeFakeResponse(true, 200, [makeListing('a', 'Apple', 'active', null)])
  })

  renderMyListings()

  const deactivateButton = await screen.findByRole('button', { name: 'Deactivate' })
  fireEvent.click(deactivateButton)
  await waitForStateUpdates()

  expect(deactivateCalled).toBe(false)
})

test('a 401 on deactivate clears the credentials', async () => {
  setLoggedIn()
  vi.stubGlobal('confirm', () => {
    return true
  })
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlText = String(url)
    if (urlText.includes('/deactivate')) {
      return makeFakeResponse(false, 401, { detail: 'Not authenticated.' })
    }
    return makeFakeResponse(true, 200, [makeListing('a', 'Apple', 'active', null)])
  })

  renderMyListings()

  const deactivateButton = await screen.findByRole('button', { name: 'Deactivate' })
  fireEvent.click(deactivateButton)

  // The shared route guard renders the logged-out message now, so the only
  // thing this page owns is clearing the stored login.
  await waitFor(() => {
    expect(window.localStorage.getItem('memberId')).toBeNull()
  })
})
