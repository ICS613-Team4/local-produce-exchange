import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { sendLoginRequest } from '../services/authService'
import { formatApiResult } from '../utils/formatApiResult'

function LoginPage() {
  const navigate = useNavigate()

  // After a successful registration, RegisterPage redirects here and tucks a
  // one-time flag into the navigation state. Read the current location and
  // check for that flag, so a friend who just registered gets a confirmation
  // instead of a silent redirect.
  const location = useLocation()
  let cameFromRegister = false
  if (location.state !== null && typeof location.state === 'object') {
    const locationState = location.state as { justRegistered?: boolean }
    if (locationState.justRegistered === true) {
      cameFromRegister = true
    }
  }

  // Keep the flag in component state so the message stays visible for this
  // visit even after we clear it from the browser history below.
  const [justRegistered] = useState(cameFromRegister)

  // react-router keeps navigation state in the browser history, and the
  // browser restores that state on a manual page refresh, which would show
  // the message again. Replace the current history entry once with one that
  // has no state, so the message really is shown only this one time.
  useEffect(function clearJustRegisteredState() {
    if (cameFromRegister) {
      navigate('.', { replace: true, state: null })
    }
  }, [cameFromRegister, navigate])

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // Holds the message shown in the error area. Empty means no error.
  const [errorMessage, setErrorMessage] = useState('')

  // Holds the raw backend response after a failed submit, for debugging.
  const [rawResponseText, setRawResponseText] = useState('')

  function handleEmailChange(event: React.ChangeEvent<HTMLInputElement>) {
    setEmail(event.target.value)
  }

  function handlePasswordChange(event: React.ChangeEvent<HTMLInputElement>) {
    setPassword(event.target.value)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedEmail = email.trim()

    if (trimmedEmail === '' || password === '') {
      setErrorMessage('Please fill in every field.')
      setRawResponseText('')
      return
    }

    const result = await sendLoginRequest(trimmedEmail, password)

    if (result.ok) {
      // Save the member info so the rest of the app knows who is
      // logged in. A proper session system arrives later; for now
      // localStorage is enough.
      const data = result.data as { id: string; name: string; email: string }
      window.localStorage.setItem('memberId', data.id)
      window.localStorage.setItem('memberName', data.name)
      window.localStorage.setItem('memberEmail', data.email)
      navigate('/dashboard')
      return
    }

    if (result.errorMessage !== '') {
      // A transport failure: timeout or network error.
      setErrorMessage(result.errorMessage)
      setRawResponseText('')
      return
    }

    // The backend answered with an HTTP error.
    let detail: unknown = undefined
    if (typeof result.data === 'object' && result.data !== null) {
      const dataObject = result.data as { detail?: unknown }
      detail = dataObject.detail
    }

    if (typeof detail === 'string') {
      setErrorMessage(detail)
    } else if (Array.isArray(detail)) {
      setErrorMessage('Please check your entries and try again.')
    } else {
      setErrorMessage('Login failed (HTTP ' + result.status + ').')
    }
    setRawResponseText(formatApiResult(result.ok, result.status, result.data))
  }

  // Build the registration success message only when the page was reached
  // right after registering. role="status" mirrors the error line's role,
  // and the class hook lets a future stylesheet target it.
  let successArea = <></>
  if (justRegistered) {
    successArea = (
      <p className="success-message" role="status">
        Your account was created. Please log in.
      </p>
    )
  }

  // Build the error area only when there is an error to show.
  let errorArea = <></>
  if (errorMessage !== '') {
    errorArea = <p role="alert">{errorMessage}</p>
  }

  // After a failed submit, also show the raw backend response.
  let rawResponseArea = <></>
  if (rawResponseText !== '') {
    rawResponseArea = (
      <pre style={{ border: '1px solid black', padding: '10px', whiteSpace: 'pre-wrap' }}>
        {rawResponseText}
      </pre>
    )
  }

  return (
    <>
      <h1>Log in</h1>
      <p>
        <Link to="/">Go to home page</Link>
      </p>
      <p>Sign in with your registered email and password.</p>
      {successArea}
      <form onSubmit={handleSubmit}>
        <p>
          <label htmlFor="login-email">Email</label>{' '}
          <input id="login-email" type="text" value={email} onChange={handleEmailChange} />
        </p>
        <p>
          <label htmlFor="login-password">Password</label>{' '}
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={handlePasswordChange}
          />
        </p>
        <p>
          For testing, use email: <code>alice@example.com</code> password:{' '}
          <code>password</code>
        </p>
        <button type="submit">Log in</button>
      </form>
      <p>
        Don't have an account? <Link to="/register">Register here</Link>
      </p>
      {errorArea}
      {rawResponseArea}
    </>
  )
}

export default LoginPage
