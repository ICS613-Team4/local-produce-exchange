// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import LoginPage from './LoginPage'

type FakeResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
}

// Unmount components and restore the real fetch after every test,
// so one test cannot leak into the next.
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

// Renders the login page plus a stand-in / route. The stand-in
// exists only so a test can prove the success redirect went to /.
function renderLoginPage() {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>home page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

// Builds a fake fetch result with only the members the service reads.
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

function fillForm(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
}

function submitForm() {
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
}

test('shows the two inputs and the submit button', () => {
  renderLoginPage()

  expect(screen.getByLabelText('Email')).toBeTruthy()
  expect(screen.getByLabelText('Password')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Log in' })).toBeTruthy()
})

test('redirects to / after a successful login', async () => {
  const responseBody = {
    id: 'a4c135d8-0000-0000-0000-000000000000',
    name: 'Alice Admin',
    email: 'alice@example.com',
    status: 'active',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, responseBody)
  })

  renderLoginPage()
  fillForm('alice@example.com', 'password')
  submitForm()

  const homeMarker = await screen.findByText('home page')
  expect(homeMarker).toBeTruthy()
})

test('stores member info in localStorage on success', async () => {
  const responseBody = {
    id: 'a4c135d8-0000-0000-0000-000000000000',
    name: 'Alice Admin',
    email: 'alice@example.com',
    status: 'active',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, responseBody)
  })

  renderLoginPage()
  fillForm('alice@example.com', 'password')
  submitForm()

  await screen.findByText('home page')
  expect(window.localStorage.getItem('memberId')).toBe('a4c135d8-0000-0000-0000-000000000000')
  expect(window.localStorage.getItem('memberName')).toBe('Alice Admin')
  expect(window.localStorage.getItem('memberEmail')).toBe('alice@example.com')
})

test('shows the backend message on a 401 wrong-credentials response', async () => {
  const responseBody = {
    detail: 'Invalid email or password.',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 401, responseBody)
  })

  renderLoginPage()
  fillForm('alice@example.com', 'wrongpassword')
  submitForm()

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toBe('Invalid email or password.')
  expect(screen.queryByText('home page')).toBeNull()
})

test('shows the suspension message on a 403 response', async () => {
  const responseBody = {
    detail: 'Your account is suspended.',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 403, responseBody)
  })

  renderLoginPage()
  fillForm('suspended@example.com', 'password')
  submitForm()

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toBe('Your account is suspended.')
  expect(screen.queryByText('home page')).toBeNull()
})

test('shows a fallback message when the error body has no detail', async () => {
  vi.stubGlobal('fetch', async () => {
    const fakeResponse = {
      ok: false,
      status: 502,
      text: async () => {
        return 'Bad Gateway'
      },
    }
    return fakeResponse
  })

  renderLoginPage()
  fillForm('alice@example.com', 'password')
  submitForm()

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toBe('Login failed (HTTP 502).')
})

test('shows the transport error message when the request times out', async () => {
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  renderLoginPage()
  fillForm('alice@example.com', 'password')
  submitForm()

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toContain('Timeout: no answer from the backend')
})

test('blocks an empty form without calling fetch', async () => {
  let fetchCallCount = 0
  vi.stubGlobal('fetch', async () => {
    fetchCallCount = fetchCallCount + 1
    return makeFakeResponse(true, 200, {})
  })

  renderLoginPage()
  submitForm()

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toBe('Please fill in every field.')
  expect(fetchCallCount).toBe(0)
  expect(screen.queryByText('home page')).toBeNull()
})

test('blocks a whitespace-only email without calling fetch', async () => {
  let fetchCallCount = 0
  vi.stubGlobal('fetch', async () => {
    fetchCallCount = fetchCallCount + 1
    return makeFakeResponse(true, 200, {})
  })

  renderLoginPage()
  fillForm('   ', 'password')
  submitForm()

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toBe('Please fill in every field.')
  expect(fetchCallCount).toBe(0)
})

test('does not store anything in localStorage on a failed login', async () => {
  const responseBody = {
    detail: 'Invalid email or password.',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 401, responseBody)
  })

  renderLoginPage()
  fillForm('alice@example.com', 'wrongpassword')
  submitForm()

  await screen.findByRole('alert')
  expect(window.localStorage.length).toBe(0)
})

// --- US-04: registration success message after a redirect ---

test('shows the registration success message when redirected after registering', () => {
  // RegisterPage redirects here with this one-time flag in the navigation
  // state, so the message should appear above the form.
  render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state: { justRegistered: true } }]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>home page</div>} />
      </Routes>
    </MemoryRouter>,
  )

  const message = screen.getByText('Your account was created. Please log in.')
  expect(message).toBeTruthy()
})

test('does not show the registration success message without that state', () => {
  // A plain visit to /login carries no such state, so no message shows.
  renderLoginPage()

  expect(screen.queryByText('Your account was created. Please log in.')).toBeNull()
})
