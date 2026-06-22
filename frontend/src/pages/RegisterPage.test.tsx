// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import RegisterPage from './RegisterPage'

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

// Renders the register page plus a stand-in /login route. The stand-in
// exists only so a test can prove the success redirect went to /login.
// In the real app /login has no route yet and falls through to the
// catch-all 404 page.
function renderRegisterPage() {
  render(
    <MemoryRouter initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<div>login page</div>} />
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

function fillForm(name: string, email: string, password: string, inviteToken: string) {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
  fireEvent.change(screen.getByLabelText('Invite token'), { target: { value: inviteToken } })
}

function submitForm() {
  fireEvent.click(screen.getByRole('button', { name: 'Register' }))
}

test('shows the four inputs and the submit button', () => {
  renderRegisterPage()

  expect(screen.getByLabelText('Name')).toBeTruthy()
  expect(screen.getByLabelText('Email')).toBeTruthy()
  expect(screen.getByLabelText('Password')).toBeTruthy()
  expect(screen.getByLabelText('Invite token')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Register' })).toBeTruthy()
})

test('redirects to /login after a successful registration', async () => {
  const responseBody = {
    id: 'a4c135d8-0000-0000-0000-000000000000',
    name: 'New Person',
    email: 'new@example.com',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, responseBody)
  })

  renderRegisterPage()
  fillForm('New Person', 'new@example.com', 'password123', 'tok-1')
  submitForm()

  // findByText waits for the navigation that follows the fake fetch.
  const loginMarker = await screen.findByText('login page')
  expect(loginMarker).toBeTruthy()
})

test('writes nothing to localStorage on a successful registration', async () => {
  const responseBody = {
    id: 'a4c135d8-0000-0000-0000-000000000000',
    name: 'New Person',
    email: 'new@example.com',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, responseBody)
  })

  renderRegisterPage()
  fillForm('New Person', 'new@example.com', 'password123', 'tok-1')
  submitForm()

  await screen.findByText('login page')
  expect(window.localStorage.length).toBe(0)
})

test('shows the backend message on a 400 bad-token response', async () => {
  const responseBody = {
    detail: 'Invalid or already-used invite token.',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 400, responseBody)
  })

  renderRegisterPage()
  fillForm('New Person', 'new@example.com', 'password123', 'bad-token')
  submitForm()

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toBe('Invalid or already-used invite token.')
  expect(screen.queryByText('login page')).toBeNull()
})

test('shows the backend message on a 409 duplicate-email response', async () => {
  const responseBody = {
    detail: 'An account with that email already exists.',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 409, responseBody)
  })

  renderRegisterPage()
  fillForm('New Person', 'alice@example.com', 'password123', 'tok-1')
  submitForm()

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toBe('An account with that email already exists.')
  expect(screen.queryByText('login page')).toBeNull()
})

test('shows the fixed message when a 422 returns a list of field errors', async () => {
  const responseBody = {
    detail: [{ type: 'string_too_short', loc: ['body', 'password'] }],
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 422, responseBody)
  })

  renderRegisterPage()
  fillForm('New Person', 'new@example.com', 'short', 'tok-1')
  submitForm()

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toBe('Please check your entries and try again.')
  expect(screen.queryByText('login page')).toBeNull()
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

  renderRegisterPage()
  fillForm('New Person', 'new@example.com', 'password123', 'tok-1')
  submitForm()

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toBe('Registration failed (HTTP 502).')
})

test('shows the transport error message when the request times out', async () => {
  vi.stubGlobal('fetch', async () => {
    // The same exception a real AbortSignal.timeout produces.
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  renderRegisterPage()
  fillForm('New Person', 'new@example.com', 'password123', 'tok-1')
  submitForm()

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toContain('Timeout: no answer from the backend')
})

// --- US-07: HTML5 validation replaces the old JS field check ---

test('marks all four inputs for HTML5 validation and autocomplete', () => {
  renderRegisterPage()

  // required on every field plus type="email" on the email is the browser-side
  // stand-in for the deleted "Please fill in every field." JS check. The
  // autocomplete tokens tell the browser this is a new account (so a password
  // manager offers to save a new password, not fill an old one) and clear
  // Chrome's "Input elements should have autocomplete attributes" warning.
  const nameInput = screen.getByLabelText('Name')
  expect(nameInput.hasAttribute('required')).toBe(true)
  expect(nameInput.getAttribute('autocomplete')).toBe('name')

  const emailInput = screen.getByLabelText('Email')
  expect(emailInput.getAttribute('type')).toBe('email')
  expect(emailInput.hasAttribute('required')).toBe(true)
  expect(emailInput.getAttribute('autocomplete')).toBe('email')

  const passwordInput = screen.getByLabelText('Password')
  expect(passwordInput.hasAttribute('required')).toBe(true)
  expect(passwordInput.getAttribute('autocomplete')).toBe('new-password')

  const tokenInput = screen.getByLabelText('Invite token')
  expect(tokenInput.hasAttribute('required')).toBe(true)
  expect(tokenInput.getAttribute('autocomplete')).toBe('off')
})

// --- US-04: invite token prefilled from a shared link ---

test('prefills the invite token from the token query parameter', () => {
  // A shared invite link carries the token in the URL, like the link the
  // invite page builds. The field should start filled with that value.
  render(
    <MemoryRouter initialEntries={['/register?token=shared-token-xyz']}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>,
  )

  const tokenField = screen.getByLabelText('Invite token') as HTMLInputElement
  expect(tokenField.value).toBe('shared-token-xyz')
})

test('leaves the invite token empty when there is no token parameter', () => {
  // No token in the URL means the field behaves exactly as it did before.
  renderRegisterPage()

  const tokenField = screen.getByLabelText('Invite token') as HTMLInputElement
  expect(tokenField.value).toBe('')
})
