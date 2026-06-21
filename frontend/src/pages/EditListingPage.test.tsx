// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import EditListingPage from './EditListingPage'

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

function makePendingResponse() {
  let resolveResponse: (response: FakeResponse) => void = () => {}
  const responsePromise = new Promise<FakeResponse>((resolve) => {
    resolveResponse = resolve
  })
  const pendingResponse = {
    promise: responsePromise,
    resolve: resolveResponse,
  }
  return pendingResponse
}

function makeActiveListing() {
  const listing = {
    id: 'abc',
    owner_id: 'member-123',
    title: 'Backyard Lemons',
    description: 'Sweet Meyer lemons.',
    category: 'Fruit',
    total_quantity: 6,
    remaining_quantity: 4,
    dietary_tags: ['vegan', 'vegetarian'],
    allergen_tags: ['contains nuts'],
    pickup_start: '2026-07-01T09:00:00.000Z',
    pickup_end: '2026-07-01T11:00:00.000Z',
    status: 'active',
    created_at: '2026-06-19T00:00:00.000Z',
  }
  return listing
}

function makeListingWithIdAndTitle(id: string, title: string) {
  const listing = makeActiveListing()
  listing.id = id
  listing.title = title
  return listing
}

function padTwoDigits(value: number) {
  let text = String(value)
  if (text.length === 1) {
    text = '0' + text
  }
  return text
}

function inputValueFromIso(isoText: string) {
  const dateValue = new Date(isoText)
  const yearText = String(dateValue.getFullYear())
  const monthText = padTwoDigits(dateValue.getMonth() + 1)
  const dayText = padTwoDigits(dateValue.getDate())
  const hourText = padTwoDigits(dateValue.getHours())
  const minuteText = padTwoDigits(dateValue.getMinutes())
  return yearText + '-' + monthText + '-' + dayText + 'T' + hourText + ':' + minuteText
}

function setLoggedIn() {
  window.localStorage.setItem('memberId', 'member-123')
  window.localStorage.setItem('memberName', 'Bob Baker')
  window.localStorage.setItem('memberEmail', 'bob@example.com')
}

function renderEditPage(initialPath = '/listings/abc/edit') {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/listings/:id/edit" element={<EditListingPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function EditPageWithSecondListingButton() {
  const navigate = useNavigate()

  function handleSecondListingClick() {
    navigate('/listings/second/edit')
  }

  return (
    <>
      <button onClick={handleSecondListingClick}>Second listing</button>
      <EditListingPage />
    </>
  )
}

function renderEditPageWithSecondButton() {
  render(
    <MemoryRouter initialEntries={['/listings/first/edit']}>
      <Routes>
        <Route path="/listings/:id/edit" element={<EditPageWithSecondListingButton />} />
      </Routes>
    </MemoryRouter>,
  )
}

async function waitForStateUpdates() {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

async function waitForLoadedForm() {
  const button = await screen.findByRole('button', { name: 'Save changes' })
  return button
}

function submitForm() {
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
}

test('shows a logged-out message and no form when no member is logged in', () => {
  renderEditPage()

  expect(screen.getByText('You need to be logged in to see this page.')).toBeTruthy()
  expect(screen.queryByLabelText('Title')).toBeNull()
})

test('shows a non-owner message and no form on direct access', async () => {
  setLoggedIn()
  const listing = makeActiveListing()
  listing.owner_id = 'other-member'
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, listing)
  })

  renderEditPage()

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('You can only edit your own listing.')
  expect(screen.queryByLabelText('Title')).toBeNull()
})

test('prefills the form for the owner', async () => {
  setLoggedIn()
  const listing = makeActiveListing()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, listing)
  })

  renderEditPage()

  await waitForLoadedForm()
  const titleInput = screen.getByLabelText('Title') as HTMLInputElement
  const descriptionInput = screen.getByLabelText('Description') as HTMLTextAreaElement
  const categoryInput = screen.getByLabelText('Category') as HTMLInputElement
  const quantityInput = screen.getByLabelText('Quantity available') as HTMLInputElement
  const dietaryInput = screen.getByLabelText('Dietary tags (comma-separated)') as HTMLInputElement
  const allergenInput = screen.getByLabelText('Allergen tags (comma-separated)') as HTMLInputElement
  const pickupStartInput = screen.getByLabelText('Pickup start') as HTMLInputElement
  const pickupEndInput = screen.getByLabelText('Pickup end') as HTMLInputElement

  expect(titleInput.value).toBe('Backyard Lemons')
  expect(descriptionInput.value).toBe('Sweet Meyer lemons.')
  expect(categoryInput.value).toBe('Fruit')
  expect(quantityInput.value).toBe('6')
  expect(dietaryInput.value).toBe('vegan, vegetarian')
  expect(allergenInput.value).toBe('contains nuts')
  expect(pickupStartInput.value).toBe(inputValueFromIso(listing.pickup_start))
  expect(pickupEndInput.value).toBe(inputValueFromIso(listing.pickup_end))
})

test('shows success, keeps the page open, and re-enables the button after save', async () => {
  setLoggedIn()
  const listing = makeActiveListing()
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options !== undefined && options.method === 'PUT') {
      return makeFakeResponse(true, 200, listing)
    }
    return makeFakeResponse(true, 200, listing)
  })

  renderEditPage()
  await waitForLoadedForm()
  submitForm()

  expect(await screen.findByText('Your changes were saved.')).toBeTruthy()
  const link = screen.getByRole('link', { name: 'View the updated listing' })
  expect(link.getAttribute('href')).toBe('/listings/abc')
  expect(screen.getByRole('heading', { name: 'Edit listing' })).toBeTruthy()
  const button = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement
  expect(button.disabled).toBe(false)
})

test('disables the button while the save request is in flight', async () => {
  setLoggedIn()
  const listing = makeActiveListing()
  const pendingSave = makePendingResponse()
  vi.stubGlobal('fetch', (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options !== undefined && options.method === 'PUT') {
      return pendingSave.promise
    }
    return Promise.resolve(makeFakeResponse(true, 200, listing))
  })

  renderEditPage()
  await waitForLoadedForm()
  submitForm()

  await waitFor(() => {
    const button = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  pendingSave.resolve(makeFakeResponse(true, 200, listing))

  await waitFor(() => {
    const button = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
  })
})

test('clears a stale success message when a field changes', async () => {
  setLoggedIn()
  const listing = makeActiveListing()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, listing)
  })

  renderEditPage()
  await waitForLoadedForm()
  submitForm()
  expect(await screen.findByText('Your changes were saved.')).toBeTruthy()

  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Changed title' } })

  expect(screen.queryByText('Your changes were saved.')).toBeNull()
})

test('shows the backend detail on a failed save without a debug dump', async () => {
  setLoggedIn()
  const listing = makeActiveListing()
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options !== undefined && options.method === 'PUT') {
      return makeFakeResponse(false, 422, { detail: 'Title must not be blank.' })
    }
    return makeFakeResponse(true, 200, listing)
  })

  renderEditPage()
  await waitForLoadedForm()
  submitForm()

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('Title must not be blank.')
  expect(document.querySelector('pre')).toBeNull()
})

test('shows the unavailable message when loading fails with 404', async () => {
  setLoggedIn()
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 404, { detail: 'This listing is unavailable.' })
  })

  renderEditPage()

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe('This listing is unavailable.')
})

test('clears stale credentials and fires the auth event on a 401 load response', async () => {
  window.localStorage.setItem('memberId', 'stale-id')
  window.localStorage.setItem('memberName', 'Bob Baker')
  window.localStorage.setItem('memberEmail', 'bob@example.com')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 401, { detail: 'Not authenticated. Unknown member.' })
  })

  // Listen for the same-tab event clearStoredLogin fires, so the shared nav can
  // flip to the logged-out view without a route change.
  let authEventFired = false
  function handleAuthEvent() {
    authEventFired = true
  }
  window.addEventListener('auth-state-changed', handleAuthEvent)

  renderEditPage()

  expect(await screen.findByText('You need to be logged in to see this page.')).toBeTruthy()
  expect(screen.queryByLabelText('Title')).toBeNull()
  expect(window.localStorage.getItem('memberId')).toBeNull()
  expect(window.localStorage.getItem('memberName')).toBeNull()
  expect(window.localStorage.getItem('memberEmail')).toBeNull()
  expect(authEventFired).toBe(true)

  window.removeEventListener('auth-state-changed', handleAuthEvent)
})

test('sends numeric quantity, split tags, and ISO pickup times on save', async () => {
  setLoggedIn()
  const listing = makeActiveListing()
  let capturedBody = ''
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options !== undefined && options.method === 'PUT') {
      capturedBody = String(options.body)
      return makeFakeResponse(true, 200, listing)
    }
    return makeFakeResponse(true, 200, listing)
  })

  renderEditPage()
  await waitForLoadedForm()
  fireEvent.change(screen.getByLabelText('Quantity available'), { target: { value: '7' } })
  fireEvent.change(screen.getByLabelText('Dietary tags (comma-separated)'), {
    target: { value: 'vegan, , organic' },
  })
  fireEvent.change(screen.getByLabelText('Allergen tags (comma-separated)'), {
    target: { value: 'nuts' },
  })
  fireEvent.change(screen.getByLabelText('Pickup start'), { target: { value: '2026-07-01T09:00' } })
  fireEvent.change(screen.getByLabelText('Pickup end'), { target: { value: '2026-07-01T11:00' } })
  submitForm()

  await screen.findByText('Your changes were saved.')

  const sentBody = JSON.parse(capturedBody)
  expect(typeof sentBody.total_quantity).toBe('number')
  expect(sentBody.total_quantity).toBe(7)
  expect(sentBody.dietary_tags).toEqual(['vegan', 'organic'])
  expect(sentBody.allergen_tags).toEqual(['nuts'])
  expect(sentBody.pickup_start).toBe(new Date('2026-07-01T09:00').toISOString())
  expect(sentBody.pickup_end).toBe(new Date('2026-07-01T11:00').toISOString())
})

test('ignores an older load response after the route changes', async () => {
  setLoggedIn()
  const firstResponse = makePendingResponse()
  const secondResponse = makePendingResponse()
  let fetchCallCount = 0
  vi.stubGlobal('fetch', async () => {
    fetchCallCount = fetchCallCount + 1
    if (fetchCallCount === 1) {
      return firstResponse.promise
    }
    if (fetchCallCount === 2) {
      return secondResponse.promise
    }
    throw new Error('Unexpected fetch')
  })

  renderEditPageWithSecondButton()

  fireEvent.click(screen.getByRole('button', { name: 'Second listing' }))

  secondResponse.resolve(makeFakeResponse(true, 200, makeListingWithIdAndTitle('second', 'Second Listing')))
  await waitForLoadedForm()
  const titleInput = screen.getByLabelText('Title') as HTMLInputElement
  expect(titleInput.value).toBe('Second Listing')

  firstResponse.resolve(makeFakeResponse(true, 200, makeListingWithIdAndTitle('first', 'First Listing')))
  await waitForStateUpdates()

  const titleInputAfterLateResponse = screen.getByLabelText('Title') as HTMLInputElement
  expect(titleInputAfterLateResponse.value).toBe('Second Listing')
})

test('shows loading instead of the old form after route change while loading', async () => {
  setLoggedIn()
  const firstListing = makeListingWithIdAndTitle('first', 'First Listing')
  const secondResponse = makePendingResponse()
  let fetchCallCount = 0
  vi.stubGlobal('fetch', async () => {
    fetchCallCount = fetchCallCount + 1
    if (fetchCallCount === 1) {
      return makeFakeResponse(true, 200, firstListing)
    }
    if (fetchCallCount === 2) {
      return secondResponse.promise
    }
    throw new Error('Unexpected fetch')
  })

  renderEditPageWithSecondButton()

  await waitForLoadedForm()
  expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('First Listing')
  fireEvent.click(screen.getByRole('button', { name: 'Second listing' }))

  await waitFor(() => {
    expect(screen.getByText('Loading the listing...')).toBeTruthy()
  })
  expect(screen.queryByDisplayValue('First Listing')).toBeNull()
})

test('does not carry submit messages or disabled state across listings', async () => {
  setLoggedIn()
  const firstListing = makeListingWithIdAndTitle('first', 'First Listing')
  const secondListing = makeListingWithIdAndTitle('second', 'Second Listing')
  vi.stubGlobal('fetch', async (url: string | URL | Request, options: RequestInit | undefined) => {
    if (options !== undefined && options.method === 'PUT') {
      return makeFakeResponse(true, 200, firstListing)
    }
    if (String(url).includes('/second')) {
      return makeFakeResponse(true, 200, secondListing)
    }
    return makeFakeResponse(true, 200, firstListing)
  })

  renderEditPageWithSecondButton()
  await waitForLoadedForm()
  submitForm()
  expect(await screen.findByText('Your changes were saved.')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Second listing' }))
  await waitForLoadedForm()

  expect(screen.queryByText('Your changes were saved.')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  const button = screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement
  expect(button.disabled).toBe(false)
})

test('refills the form from the saved response after a successful save', async () => {
  setLoggedIn()
  const listing = makeActiveListing()
  const savedListing = makeActiveListing()
  savedListing.title = 'Fresh Kale'
  savedListing.dietary_tags = ['Vegan']
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options !== undefined && options.method === 'PUT') {
      return makeFakeResponse(true, 200, savedListing)
    }
    return makeFakeResponse(true, 200, listing)
  })

  renderEditPage()
  await waitForLoadedForm()
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: '  Fresh Kale  ' } })
  fireEvent.change(screen.getByLabelText('Dietary tags (comma-separated)'), {
    target: { value: ' Vegan , , Vegan ' },
  })
  submitForm()

  await screen.findByText('Your changes were saved.')
  const titleInput = screen.getByLabelText('Title') as HTMLInputElement
  const dietaryInput = screen.getByLabelText('Dietary tags (comma-separated)') as HTMLInputElement
  expect(titleInput.value).toBe('Fresh Kale')
  expect(dietaryInput.value).toBe('Vegan')
})

test('clears stale credentials and fires the auth event on a 401 save response', async () => {
  setLoggedIn()
  const listing = makeActiveListing()
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options !== undefined && options.method === 'PUT') {
      return makeFakeResponse(false, 401, { detail: 'Not authenticated. Unknown member.' })
    }
    return makeFakeResponse(true, 200, listing)
  })

  // Listen for the same-tab event clearStoredLogin fires on a save-time 401.
  let authEventFired = false
  function handleAuthEvent() {
    authEventFired = true
  }
  window.addEventListener('auth-state-changed', handleAuthEvent)

  renderEditPage()
  await waitForLoadedForm()
  submitForm()

  expect(await screen.findByText('You need to be logged in to see this page.')).toBeTruthy()
  expect(window.localStorage.getItem('memberId')).toBeNull()
  expect(window.localStorage.getItem('memberName')).toBeNull()
  expect(window.localStorage.getItem('memberEmail')).toBeNull()
  expect(screen.queryByLabelText('Title')).toBeNull()
  expect(authEventFired).toBe(true)

  window.removeEventListener('auth-state-changed', handleAuthEvent)
})
