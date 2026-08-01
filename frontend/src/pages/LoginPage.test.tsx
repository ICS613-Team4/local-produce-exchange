// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
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

// Prints the "from" value in the current history entry, so a test can read the
// navigation state off the screen instead of reaching into router internals.
function StateProbe({ label }: { label: string }) {
  const location = useLocation()
  let fromValue = ''
  let sawJustRegistered = 'no'
  if (location.state !== null && typeof location.state === 'object') {
    const locationState = location.state as { from?: unknown; justRegistered?: unknown }
    if (typeof locationState.from === 'string') {
      fromValue = locationState.from
    }
    if (locationState.justRegistered === true) {
      sawJustRegistered = 'yes'
    }
  }
  return (
    <div
      data-testid={label}
      data-location={location.pathname + location.search}
      data-from={fromValue}
      data-just-registered={sawJustRegistered}
    >
      <p>{label}</p>
      <p>
        {label} location: {location.pathname + location.search}
      </p>
      <p>
        {label} from: {fromValue}
      </p>
      <p>
        {label} justRegistered: {sawJustRegistered}
      </p>
    </div>
  )
}

function HistoryBackButton() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate(-1)}>Back one entry</button>
}

// Renders the login page plus stand-in routes for every page the login flow can
// reach: /, /dashboard, /browse (a member-only page a guard redirected away
// from), and /register. The login, browse, and register probes print location
// and navigation state, so the return-target tests can check each history
// entry. The starting entry is a parameter so a test can arrive with state
// already in place, the way a guard's redirect does.
function renderLoginPage(initialEntries: object[] | string[] = ['/login']) {
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route
          path="/login"
          element={(
            <>
              <LoginPage />
              <StateProbe label="login page state" />
              <HistoryBackButton />
            </>
          )}
        />
        <Route path="/" element={<div>home page</div>} />
        <Route path="/dashboard" element={<div>dashboard page</div>} />
        <Route path="/browse" element={<StateProbe label="browse page" />} />
        <Route path="/register" element={<StateProbe label="register page" />} />
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

test('redirects to the dashboard after a successful login', async () => {
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

  const dashboardMarker = await screen.findByText('dashboard page')
  expect(dashboardMarker).toBeTruthy()
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

  await screen.findByText('dashboard page')
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
  expect(screen.queryByText('dashboard page')).toBeNull()
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
  expect(screen.queryByText('dashboard page')).toBeNull()
})

test('shows the specific field message when a 422 returns a list of field errors', async () => {
  const responseBody = {
    detail: [{ type: 'value_error', loc: ['body', 'email'], msg: 'value is not a valid email address' }],
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 422, responseBody)
  })

  renderLoginPage()
  fillForm('alice@example.com', 'password')
  submitForm()

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toBe('value is not a valid email address')
  expect(screen.queryByText('dashboard page')).toBeNull()
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

// --- US-07: HTML5 validation replaces the old JS field check ---

test('marks the email and password inputs for HTML5 validation and autocomplete', () => {
  renderLoginPage()

  // type="email" plus required is the browser-side stand-in for the deleted
  // "Please fill in every field." JS check. The autocomplete tokens tell the
  // browser and password managers this is a login form, which clears Chrome's
  // "Input elements should have autocomplete attributes" warning.
  const emailInput = screen.getByLabelText('Email')
  expect(emailInput.getAttribute('type')).toBe('email')
  expect(emailInput.hasAttribute('required')).toBe(true)
  expect(emailInput.getAttribute('autocomplete')).toBe('username')

  const passwordInput = screen.getByLabelText('Password')
  expect(passwordInput.hasAttribute('required')).toBe(true)
  expect(passwordInput.getAttribute('autocomplete')).toBe('current-password')
})

// --- US-07: the form is hidden when already logged in ---

test('hides the form and shows the already-logged-in view when logged in', () => {
  window.localStorage.setItem('memberId', 'a4c135d8-0000-0000-0000-000000000000')
  window.localStorage.setItem('memberName', 'Alice Admin')
  window.localStorage.setItem('memberEmail', 'alice@example.com')

  renderLoginPage()

  // The form is gone and the already-logged-in view shows. The shared nav owns
  // logout now, so this page has no Log out button. With no return target in
  // the navigation state, the one button here goes to the dashboard; the
  // "Continue" test below covers the case where a guard sent one along.
  expect(screen.queryByLabelText('Email')).toBeNull()
  expect(screen.getByText("You're already logged in as Alice Admin.")).toBeTruthy()
  const dashboardLink = screen.getByRole('link', { name: 'Go to Dashboard' })
  expect(dashboardLink.getAttribute('href')).toBe('/dashboard')
})

test('shows the registration success message even when logged in', () => {
  window.localStorage.setItem('memberId', 'a4c135d8-0000-0000-0000-000000000000')
  window.localStorage.setItem('memberName', 'Alice Admin')
  render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state: { justRegistered: true } }]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>home page</div>} />
        <Route path="/dashboard" element={<div>dashboard page</div>} />
      </Routes>
    </MemoryRouter>,
  )

  // The logged-in branch shows the shorter confirmation, without "Please log in."
  expect(screen.getByText('Your account was created.')).toBeTruthy()
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

// --- US-34: return to the member-only page the guard redirected away from ---

// The login answer every success test below uses.
const successfulLoginBody = {
  id: 'a4c135d8-0000-0000-0000-000000000000',
  name: 'Alice Admin',
  email: 'alice@example.com',
  status: 'active',
}

function stubSuccessfulLogin() {
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, successfulLoginBody)
  })
}

test('returns to the requested page after a successful login', async () => {
  // This is the state RequireAuth hands over when it redirects a logged-out
  // visitor away from /browse.
  stubSuccessfulLogin()
  renderLoginPage([{ pathname: '/login', state: { from: '/browse' } }])

  fillForm('alice@example.com', 'password')
  submitForm()

  expect(await screen.findByText('browse page')).toBeTruthy()
})

test('keeps the query string when it returns to the requested page', async () => {
  stubSuccessfulLogin()
  renderLoginPage([{ pathname: '/login', state: { from: '/browse?category=fruit' } }])

  fillForm('alice@example.com', 'password')
  submitForm()

  expect(await screen.findByText('browse page')).toBeTruthy()
  expect(screen.getByTestId('browse page').getAttribute('data-location')).toBe(
    '/browse?category=fruit',
  )
})

test('falls back to the dashboard when there is no return target', async () => {
  stubSuccessfulLogin()
  renderLoginPage()

  fillForm('alice@example.com', 'password')
  submitForm()

  expect(await screen.findByText('dashboard page')).toBeTruthy()
})

test('refuses a return target that points at another site', async () => {
  // An absolute URL would send the member off this site entirely.
  stubSuccessfulLogin()
  renderLoginPage([{ pathname: '/login', state: { from: 'https://evil.test' } }])

  fillForm('alice@example.com', 'password')
  submitForm()

  expect(await screen.findByText('dashboard page')).toBeTruthy()
})

test('refuses a protocol-relative return target', async () => {
  // "//evil.test" names another site without naming a protocol.
  stubSuccessfulLogin()
  renderLoginPage([{ pathname: '/login', state: { from: '//evil.test' } }])

  fillForm('alice@example.com', 'password')
  submitForm()

  expect(await screen.findByText('dashboard page')).toBeTruthy()
})

test('refuses a backslash return target', async () => {
  // Browsers read "/\evil.test" the same way they read "//evil.test".
  stubSuccessfulLogin()
  renderLoginPage([{ pathname: '/login', state: { from: '/\\evil.test' } }])

  fillForm('alice@example.com', 'password')
  submitForm()

  expect(await screen.findByText('dashboard page')).toBeTruthy()
})

test('falls back when parsing the return target fails', async () => {
  // A backslash starts an authority, and the opening bracket makes that
  // authority invalid, so the URL parser throws.
  stubSuccessfulLogin()
  renderLoginPage([{ pathname: '/login', state: { from: '/\\[' } }])

  fillForm('alice@example.com', 'password')
  submitForm()

  expect(await screen.findByText('dashboard page')).toBeTruthy()
})

test('falls back when the return target is not a string', async () => {
  stubSuccessfulLogin()
  renderLoginPage([{ pathname: '/login', state: { from: 123 } }])

  fillForm('alice@example.com', 'password')
  submitForm()

  expect(await screen.findByText('dashboard page')).toBeTruthy()
})

test('offers a Continue link to the requested page when already logged in', () => {
  window.localStorage.setItem('memberId', 'a4c135d8-0000-0000-0000-000000000000')
  window.localStorage.setItem('memberName', 'Alice Admin')

  renderLoginPage([{ pathname: '/login', state: { from: '/browse' } }])

  const continueLink = screen.getByRole('link', { name: 'Continue' })
  expect(continueLink.getAttribute('href')).toBe('/browse')
  expect(screen.queryByRole('link', { name: 'Go to Dashboard' })).toBeNull()
})

test('passes the return target on to the Register here link', () => {
  renderLoginPage([{ pathname: '/login', state: { from: '/browse' } }])

  fireEvent.click(screen.getByRole('link', { name: 'Register here' }))

  expect(screen.getByText('register page')).toBeTruthy()
  expect(screen.getByText('register page from: /browse')).toBeTruthy()
})

test('keeps the return target when it clears the one-time registration flag', async () => {
  // RegisterPage sends both values. The one-time flag has to go so a refresh
  // does not repeat the message, but the return target has to stay.
  renderLoginPage([
    { pathname: '/login', state: { justRegistered: true, from: '/browse' } },
  ])

  // The message still shows on this visit.
  expect(screen.getByText('Your account was created. Please log in.')).toBeTruthy()

  // Read the current router entry after the effect rewrites it. Component state
  // alone is not proof because LoginPage keeps its first target in useState.
  await waitFor(() => {
    const loginState = screen.getByTestId('login page state')
    expect(loginState.getAttribute('data-from')).toBe('/browse')
    expect(loginState.getAttribute('data-just-registered')).toBe('no')
  })
})

test('replaces the registration entry when it clears the one-time flag', async () => {
  renderLoginPage([
    { pathname: '/register' },
    { pathname: '/login', state: { justRegistered: true, from: '/browse' } },
  ])

  await waitFor(() => {
    expect(
      screen.getByTestId('login page state').getAttribute('data-just-registered'),
    ).toBe('no')
  })
  fireEvent.click(screen.getByRole('button', { name: 'Back one entry' }))

  expect(await screen.findByText('register page')).toBeTruthy()
})

test('still returns to the requested page after remounting the rewritten entry', async () => {
  // First let LoginPage produce the state that a refresh would restore.
  renderLoginPage([
    { pathname: '/login', state: { justRegistered: true, from: '/browse' } },
  ])

  await waitFor(() => {
    expect(
      screen.getByTestId('login page state').getAttribute('data-just-registered'),
    ).toBe('no')
  })
  const retainedFrom = screen.getByTestId('login page state').getAttribute('data-from') ?? ''

  // Unmount and rebuild the router from the state the effect left behind. This
  // models a page refresh instead of supplying the expected value by hand.
  cleanup()
  stubSuccessfulLogin()
  renderLoginPage([{ pathname: '/login', state: { from: retainedFrom } }])

  expect(screen.queryByText('Your account was created. Please log in.')).toBeNull()
  fillForm('alice@example.com', 'password')
  submitForm()

  expect(await screen.findByText('browse page')).toBeTruthy()
})
