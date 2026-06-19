import { useState } from 'react'
import { Link } from 'react-router'

import { sendCreateInviteRequest } from '../services/inviteService'

function InvitePage() {
  // Read the logged-in member's id from localStorage. There is no server
  // session yet, so this is how the page knows who is acting. An empty value
  // means nobody is logged in here.
  const memberId = window.localStorage.getItem('memberId') ?? ''

  // The plaintext token the backend returns. Empty until one is created.
  const [token, setToken] = useState('')

  // The shareable registration link built from the token. Empty until then.
  const [shareLink, setShareLink] = useState('')

  // The message shown when creating an invite fails. Empty means no error.
  const [errorMessage, setErrorMessage] = useState('')

  // A short note shown after the copy button is used.
  const [copyMessage, setCopyMessage] = useState('')

  async function handleCreateInvite() {
    setErrorMessage('')
    setCopyMessage('')

    const result = await sendCreateInviteRequest(memberId)

    if (result.ok) {
      const data = result.data as { token: string }
      const newToken = data.token
      // Build the link from the current site address, so it is correct in
      // dev (localhost) and in production with no hardcoding.
      const newShareLink =
        window.location.origin + '/register?token=' + encodeURIComponent(newToken)
      setToken(newToken)
      setShareLink(newShareLink)
      return
    }

    if (result.errorMessage !== '') {
      // A transport failure: timeout or network error.
      setErrorMessage(result.errorMessage)
      return
    }

    // The backend answered with an HTTP error. FastAPI puts the reason in a
    // "detail" field (401 missing identity, 403 suspended, 503 database).
    let detail: unknown = undefined
    if (typeof result.data === 'object' && result.data !== null) {
      const dataObject = result.data as { detail?: unknown }
      detail = dataObject.detail
    }

    if (typeof detail === 'string') {
      setErrorMessage(detail)
    } else {
      setErrorMessage('Could not create an invite (HTTP ' + result.status + ').')
    }
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(shareLink)
      setCopyMessage('Link copied.')
    } catch {
      setCopyMessage('Could not copy automatically. Please copy the link by hand.')
    }
  }

  // Not logged in: no memberId in localStorage. Show a prompt and stop here,
  // so the create button never appears and the backend is never called.
  if (memberId === '') {
    return (
      <>
        <h1>Invite a new member</h1>
        <p>
          <Link to="/">Go to home page</Link>
        </p>
        <p>Please log in to create an invite.</p>
      </>
    )
  }

  // Build the success area only after a token has been created.
  let successArea = <></>
  if (token !== '') {
    let copyArea = <></>
    if (copyMessage !== '') {
      copyArea = <p role="status">{copyMessage}</p>
    }
    successArea = (
      <div>
        <p>
          Here is your invite. It is shown once and will not be shown again, so
          copy it now.
        </p>
        <p>Shareable registration link:</p>
        <p>
          <span>{shareLink}</span>{' '}
          <button onClick={handleCopyLink}>Copy link</button>
        </p>
        {copyArea}
        <p>Or share this raw token instead:</p>
        <pre style={{ border: '1px solid black', padding: '10px', whiteSpace: 'pre-wrap' }}>
          {token}
        </pre>
      </div>
    )
  }

  // Build the error area only when there is an error to show.
  let errorArea = <></>
  if (errorMessage !== '') {
    errorArea = <p role="alert">{errorMessage}</p>
  }

  return (
    <>
      <h1>Invite a new member</h1>
      <p>
        <Link to="/">Go to home page</Link>
      </p>
      <p>
        Create an invite token to bring a new person into the community. Share
        it with them so they can register.
      </p>
      <button onClick={handleCreateInvite}>Create an invite</button>
      {successArea}
      {errorArea}
    </>
  )
}

export default InvitePage
