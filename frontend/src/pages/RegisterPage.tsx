import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import { sendRegisterRequest } from '../services/authService'

function RegisterPage() {
  // useNavigate is a hook, so it must be called here at the top level,
  // not inside the submit handler.
  const navigate = useNavigate()

  // A shared invite link looks like /register?token=abc123. Read that token
  // from the URL and use it as the starting value of the invite-token field,
  // so a friend who clicked the link sees the field already filled in. When
  // there is no token in the URL, the field starts empty as before.
  const [searchParams] = useSearchParams()
  const tokenFromLink = searchParams.get('token') ?? ''

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [inviteToken, setInviteToken] = useState(tokenFromLink)

  // Holds the message shown in the error area. Empty means no error.
  const [errorMessage, setErrorMessage] = useState('')

  function handleNameChange(event: React.ChangeEvent<HTMLInputElement>) {
    setName(event.target.value)
  }

  function handleEmailChange(event: React.ChangeEvent<HTMLInputElement>) {
    setEmail(event.target.value)
  }

  function handlePasswordChange(event: React.ChangeEvent<HTMLInputElement>) {
    setPassword(event.target.value)
  }

  function handleInviteTokenChange(event: React.ChangeEvent<HTMLInputElement>) {
    setInviteToken(event.target.value)
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    // No JS field check here: the HTML5 required attribute on all four inputs,
    // plus type="email" on the email, block an empty form or a malformed email
    // before submit. The backend stays the authority for trimming and rejecting
    // bad input, so a whitespace-only name or token still reaches it and is
    // rejected there.
    const result = await sendRegisterRequest(name, email, password, inviteToken)

    if (result.ok) {
      // The account exists now. Send the user to the login page and pass a
      // one-time flag so that page can show a success message. The flag
      // travels with this redirect but clears on a manual refresh, which is
      // what a one-time message should do. No session is started and nothing
      // is written to localStorage; logging in happens on the next page.
      navigate('/login', { state: { justRegistered: true } })
      return
    }

    if (result.errorMessage !== '') {
      // A transport failure: timeout or network error. There is no
      // backend response to show.
      setErrorMessage(result.errorMessage)
      return
    }

    // The backend answered with an HTTP error. FastAPI puts the reason in
    // a "detail" member: a plain string for 400 and 409, or a list with
    // one entry per field problem for 422.
    let detail: unknown = undefined
    if (typeof result.data === 'object' && result.data !== null) {
      const dataObject = result.data as { detail?: unknown }
      detail = dataObject.detail
    }

    if (typeof detail === 'string') {
      setErrorMessage(detail)
    } else if (Array.isArray(detail)) {
      // A 422 lists one entry per field problem, each with a plain-words "msg"
      // like "String should have at least 8 characters". Pull those messages out
      // and show them, instead of a generic line or the raw JSON. Join with a
      // semicolon when more than one field is wrong.
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
      setErrorMessage('Registration failed (HTTP ' + result.status + ').')
    }
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
        <h1 className="text-2xl font-bold text-text mb-2">Register</h1>
        <p className="text-sm text-text-muted mb-6">Create your member account with the invite token you received.</p>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="register-name" className={labelClasses}>Name</label>
            <input
              id="register-name"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={handleNameChange}
              className={inputClasses}
              placeholder="Your name"
            />
          </div>
          <div>
            <label htmlFor="register-email" className={labelClasses}>Email</label>
            <input
              id="register-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={handleEmailChange}
              className={inputClasses}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label htmlFor="register-password" className={labelClasses}>Password</label>
            <input
              id="register-password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={handlePasswordChange}
              className={inputClasses}
            />
          </div>
          <div>
            <label htmlFor="register-invite-token" className={labelClasses}>Invite token</label>
            <input
              id="register-invite-token"
              type="text"
              autoComplete="off"
              required
              value={inviteToken}
              onChange={handleInviteTokenChange}
              className={inputClasses}
              placeholder="Paste your invite token"
            />
          </div>
          <div className="rounded-lg bg-background-alt px-4 py-3 text-xs text-text-muted">
            For testing, use invite token:{' '}
            <code className="font-mono bg-background px-1.5 py-0.5 rounded text-primary-700">demo-invite-pending-abc123</code>{' '}
            (one time use)
          </div>
          <button
            type="submit"
            className="w-full px-4 py-2.5 text-sm font-semibold text-text-inverse bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm hover:shadow transition-all duration-150"
          >
            Register
          </button>
        </form>
        {errorArea}
        <p className="mt-6 text-center text-sm text-text-muted">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary-600 hover:text-primary-700">
            Log in
          </Link>
        </p>
      </div>
    </div>
  )
}

export default RegisterPage
