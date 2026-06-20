// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import CreateListingPage from './CreateListingPage'

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

// A stand-in for the detail page (the new success target), so a test can prove
// the create flow navigated to /listings/<id> carrying the new listing's id.
function ShowsListingId() {
  const params = useParams()
  const listingId = params.id ?? ''
  return <div>listing {listingId}</div>
}

// Renders the create page plus the detail stand-in (the success target) and a
// stand-in login route (the redirect-guard target).
function renderCreatePage() {
  render(
    <MemoryRouter initialEntries={['/listings/create']}>
      <Routes>
        <Route path="/listings/create" element={<CreateListingPage />} />
        <Route path="/listings/:id" element={<ShowsListingId />} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

// Builds a fake fetch result with only the members the service reads.
function makeFakeResponse(ok: boolean, status: number, bodyText: string): FakeResponse {
  const fakeResponse = {
    ok: ok,
    status: status,
    text: async () => {
      return bodyText
    },
  }
  return fakeResponse
}

// A fetch result the test resolves by hand, to check the in-flight state.
function makePendingResponse() {
  let resolveResponse: (response: FakeResponse) => void = () => {}
  const responsePromise = new Promise<FakeResponse>((resolve) => {
    resolveResponse = resolve
  })
  const pending = {
    responsePromise: responsePromise,
    resolveResponse: resolveResponse,
  }
  return pending
}

function fillForm() {
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Fresh Tomatoes' } })
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Ripe red tomatoes.' } })
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Vegetables' } })
  fireEvent.change(screen.getByLabelText('Quantity available'), { target: { value: '5' } })
  // The blank middle piece checks that splitTags drops empty tags.
  fireEvent.change(screen.getByLabelText('Dietary tags (comma-separated)'), {
    target: { value: 'vegan, , organic' },
  })
  fireEvent.change(screen.getByLabelText('Allergen tags (comma-separated)'), {
    target: { value: 'nuts' },
  })
  fireEvent.change(screen.getByLabelText('Pickup start'), { target: { value: '2026-07-01T09:00' } })
  fireEvent.change(screen.getByLabelText('Pickup end'), { target: { value: '2026-07-01T11:00' } })
}

function submitForm() {
  fireEvent.click(screen.getByRole('button', { name: 'Create listing' }))
}

test('renders all the listing fields and the submit button', () => {
  window.localStorage.setItem('memberId', 'member-123')
  renderCreatePage()

  expect(screen.getByLabelText('Title')).toBeTruthy()
  expect(screen.getByLabelText('Description')).toBeTruthy()
  expect(screen.getByLabelText('Category')).toBeTruthy()
  expect(screen.getByLabelText('Quantity available')).toBeTruthy()
  expect(screen.getByLabelText('Dietary tags (comma-separated)')).toBeTruthy()
  expect(screen.getByLabelText('Allergen tags (comma-separated)')).toBeTruthy()
  expect(screen.getByLabelText('Pickup start')).toBeTruthy()
  expect(screen.getByLabelText('Pickup end')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Create listing' })).toBeTruthy()
})

test('marks the required fields and uses the right input types', () => {
  window.localStorage.setItem('memberId', 'member-123')
  renderCreatePage()

  const title = screen.getByLabelText('Title')
  expect(title.hasAttribute('required')).toBe(true)

  const description = screen.getByLabelText('Description')
  expect(description.hasAttribute('required')).toBe(true)
  expect(description.tagName).toBe('TEXTAREA')

  const category = screen.getByLabelText('Category')
  expect(category.hasAttribute('required')).toBe(true)

  const quantity = screen.getByLabelText('Quantity available')
  expect(quantity.getAttribute('type')).toBe('number')
  expect(quantity.getAttribute('min')).toBe('1')
  expect(quantity.hasAttribute('required')).toBe(true)

  const pickupStart = screen.getByLabelText('Pickup start')
  expect(pickupStart.getAttribute('type')).toBe('datetime-local')
  expect(pickupStart.hasAttribute('required')).toBe(true)

  const pickupEnd = screen.getByLabelText('Pickup end')
  expect(pickupEnd.getAttribute('type')).toBe('datetime-local')
  expect(pickupEnd.hasAttribute('required')).toBe(true)
})

test('navigates to the new listing detail page after a successful create', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 201, JSON.stringify({ id: 'x', owner_id: 'member-123', status: 'active' }))
  })

  renderCreatePage()
  fillForm()
  submitForm()

  // The detail stand-in shows the id, proving the redirect went to /listings/x.
  const detailMarker = await screen.findByText('listing x')
  expect(detailMarker).toBeTruthy()
})

test('sends the member id header, a number quantity, split tags, and ISO pickup times', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  let capturedOptions: RequestInit = {}
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options !== undefined) {
      capturedOptions = options
    }
    return makeFakeResponse(true, 201, JSON.stringify({ id: 'x', owner_id: 'member-123', status: 'active' }))
  })

  renderCreatePage()
  fillForm()
  submitForm()

  await screen.findByText('listing x')

  // The id rides in the header, not the body.
  expect(JSON.stringify(capturedOptions.headers)).toContain('X-Member-Id')
  expect(JSON.stringify(capturedOptions.headers)).toContain('member-123')

  const sentBody = JSON.parse(String(capturedOptions.body))
  expect(typeof sentBody.total_quantity).toBe('number')
  expect(sentBody.total_quantity).toBe(5)
  expect(sentBody.dietary_tags).toEqual(['vegan', 'organic'])
  expect(sentBody.allergen_tags).toEqual(['nuts'])
  // Compare against the same conversion the test computes, so the assertion is
  // not tied to the machine's timezone.
  expect(sentBody.pickup_start).toBe(new Date('2026-07-01T09:00').toISOString())
  expect(sentBody.pickup_end).toBe(new Date('2026-07-01T11:00').toISOString())
})

test('shows the backend message on a 422 response', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 422, JSON.stringify({ detail: 'Quantity available must be greater than zero.' }))
  })

  renderCreatePage()
  fillForm()
  submitForm()

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toBe('Quantity available must be greater than zero.')
})

test('shows a transport error when the request fails', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  vi.stubGlobal('fetch', async () => {
    throw new TypeError('Failed to fetch')
  })

  renderCreatePage()
  fillForm()
  submitForm()

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toContain('Request failed')
})

test('shows a generic message when the error detail is a list', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 422, JSON.stringify({ detail: [{ msg: 'bad' }] }))
  })

  renderCreatePage()
  fillForm()
  submitForm()

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toBe('Please check your entries and try again.')
})

test('shows a fallback message when the error body has no detail', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 500, 'Server error')
  })

  renderCreatePage()
  fillForm()
  submitForm()

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toBe('Could not create the listing (HTTP 500).')
})

test('redirects to login when no member is logged in', () => {
  // localStorage has no memberId, so the guard sends the visitor to login.
  renderCreatePage()

  expect(screen.getByText('login page')).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Create a listing' })).toBeNull()
})

test('renders the form when a member is logged in', () => {
  window.localStorage.setItem('memberId', 'member-123')
  renderCreatePage()

  expect(screen.getByRole('heading', { name: 'Create a listing' })).toBeTruthy()
  expect(screen.queryByText('login page')).toBeNull()
})

test('disables the submit button while the request is in flight', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  const pending = makePendingResponse()
  vi.stubGlobal('fetch', () => {
    return pending.responsePromise
  })

  renderCreatePage()
  fillForm()
  submitForm()

  // Mid-flight the button is disabled, so a second click cannot fire.
  await waitFor(() => {
    const button = screen.getByRole('button', { name: 'Create listing' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  // Finishing the request (here with a non-ok result) re-enables the button.
  pending.resolveResponse(makeFakeResponse(false, 422, JSON.stringify({ detail: 'No.' })))

  await waitFor(() => {
    const button = screen.getByRole('button', { name: 'Create listing' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
  })
})

test('keeps the form and disables submit when the created listing has no id', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  // A 201 whose body carries no string id. This should not happen on a real
  // create, but the page guards against it instead of blind-navigating.
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 201, JSON.stringify({ owner_id: 'member-123', status: 'active' }))
  })

  renderCreatePage()
  fillForm()
  submitForm()

  // The page shows the "created but could not open" alert and stays on the form.
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe(
    'The listing was created, but the app could not open its page. Go to the dashboard.',
  )
  expect(screen.getByRole('heading', { name: 'Create a listing' })).toBeTruthy()
  // It did not navigate to the detail stand-in route.
  expect(screen.queryByText('listing x')).toBeNull()
  // The submit button stays disabled, so the already-created listing cannot be
  // submitted a second time.
  const button = screen.getByRole('button', { name: 'Create listing' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
})
