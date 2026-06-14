import { useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { sendLoginRequest } from '../services/authService'
import { formatApiResult } from '../utils/formatApiResult'

function LoginPage() {
  const navigate = useNavigate()

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
      navigate('/')
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
