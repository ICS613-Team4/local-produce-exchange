import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { sendLoginRequest } from '../services/authService'

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

  // Auth truth is memberId: logged in means it is not empty. memberName is read
  // the same way but used only for the display text (the two can drift). The
  // shared nav owns logout now, and logging out from there navigates away from
  // this page, so these are plain reads with no setters.
  const memberId = window.localStorage.getItem('memberId') ?? ''
  const memberName = window.localStorage.getItem('memberName') ?? ''

  function handleEmailChange(event: React.ChangeEvent<HTMLInputElement>) {
    setEmail(event.target.value)
  }

  function handlePasswordChange(event: React.ChangeEvent<HTMLInputElement>) {
    setPassword(event.target.value)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    // No JS field check here: the HTML5 required attribute and type="email" on
    // the inputs block an empty or malformed email before submit. The backend
    // stays the authority for trimming and rejecting bad input.
    const result = await sendLoginRequest(email, password)

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
      // A 422 lists one entry per field problem, each with a plain-words "msg".
      // Show those messages instead of a generic line or the raw JSON, joined
      // with a semicolon when more than one field is wrong.
      const fieldMessages = []
      for (let index = 0; index < detail.length; index = index + 1) {
        const entry = detail[index]
        if (typeof entry === 'object' && entry !== null) {
          const entryObject = entry as { msg?: unknown }
          if (typeof entryObject.msg === 'string') {
            fieldMessages.push(entryObject.msg)
          }
        }
      }
      if (fieldMessages.length > 0) {
        setErrorMessage(fieldMessages.join('; '))
      } else {
        setErrorMessage('Please check your entries and try again.')
      }
    } else {
      setErrorMessage('Login failed (HTTP ' + result.status + ').')
    }
  }

  // Logged-in branch: hide the form and show an "already logged in" view, so a
  // logged-in person can go to the dashboard or switch accounts by logging out.
  // Every hook above runs regardless of which branch returns, so the Rules of
  // Hooks hold.
  if (memberId !== '') {
    let alreadyLoggedInLine = "You're already logged in."
    if (memberName !== '') {
      alreadyLoggedInLine = "You're already logged in as " + memberName + '.'
    }
    // Keep the registration confirmation here too, but without "Please log in.",
    // which would contradict someone who is already logged in.
    let loggedInSuccessArea = <></>
    if (justRegistered) {
      loggedInSuccessArea = (
        <div className="rounded-lg bg-success-bg border border-green-200 px-4 py-3 text-sm text-success mb-4" role="status">
          Your account was created.
        </div>
      )
    }
    return (
      <div className="max-w-md mx-auto">
        <div className="bg-surface rounded-xl border border-border p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-text mb-4">Log in</h1>
          {loggedInSuccessArea}
          <p className="text-text-muted">{alreadyLoggedInLine}</p>
          <Link
            to="/dashboard"
            className="mt-6 inline-flex items-center justify-center w-full px-4 py-2.5 text-sm font-semibold text-text-inverse bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  // Build the registration success message only when the page was reached
  // right after registering. role="status" mirrors the error line's role,
  // and the class hook lets a future stylesheet target it.
  let successArea = <></>
  if (justRegistered) {
    successArea = (
      <div className="rounded-lg bg-success-bg border border-green-200 px-4 py-3 text-sm text-success mb-4" role="status">
        Your account was created. Please log in.
      </div>
    )
  }

  // Build the error area only when there is an error to show.
  let errorArea = <></>
  if (errorMessage !== '') {
    errorArea = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error mt-4" role="alert">
        {errorMessage}
      </div>
    )
  }

  const inputClasses = 'w-full px-4 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-150'
  const labelClasses = 'block text-sm font-medium text-text mb-1.5'

  return (
    <div className="max-w-md mx-auto">
      <div className="bg-surface rounded-xl border border-border p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-text mb-2">Log in</h1>
        <p className="text-sm text-text-muted mb-6">Sign in with your registered email and password.</p>
        {successArea}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="login-email" className={labelClasses}>Email</label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={handleEmailChange}
              className={inputClasses}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label htmlFor="login-password" className={labelClasses}>Password</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={handlePasswordChange}
              className={inputClasses}
            />
          </div>
          <div className="rounded-lg bg-background-alt px-4 py-3 text-xs text-text-muted">
            For testing, use email: <code className="font-mono bg-background px-1.5 py-0.5 rounded text-primary-700">alice@example.com</code> password:{' '}
            <code className="font-mono bg-background px-1.5 py-0.5 rounded text-primary-700">password</code>
          </div>
          <button
            type="submit"
            className="w-full px-4 py-2.5 text-sm font-semibold text-text-inverse bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm hover:shadow transition-all duration-150"
          >
            Log in
          </button>
        </form>
        {errorArea}
        <p className="mt-6 text-center text-sm text-text-muted">
          Don't have an account?{' '}
          <Link to="/register" className="font-medium text-primary-600 hover:text-primary-700">
            Register here
          </Link>
        </p>
      </div>
    </div>
  )
}

export default LoginPage
