import { useState } from 'react'

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

  // Build the success area only after a token has been created.
  let successArea = <></>
  if (token !== '') {
    let copyArea = <></>
    if (copyMessage !== '') {
      copyArea = (
        <p className="text-sm text-success mt-2" role="status">{copyMessage}</p>
      )
    }
    successArea = (
      <div className="mt-6 space-y-4">
        <div className="rounded-lg bg-success-bg border border-green-200 px-4 py-3">
          <p className="text-sm font-medium text-success mb-1">Invite created!</p>
          <p className="text-xs text-text-muted">
            This token is shown once and will not be shown again. Copy it now.
          </p>
        </div>
        <div>
          <p className="text-sm font-medium text-text mb-2">Shareable registration link:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono bg-background border border-border rounded-lg px-3 py-2.5 break-all text-primary-700">
              {shareLink}
            </code>
            <button
              onClick={handleCopyLink}
              className="shrink-0 inline-flex items-center px-4 py-2.5 text-sm font-medium text-primary-600 border border-primary-200 rounded-lg hover:bg-primary-50 transition-colors"
            >
              Copy link
            </button>
          </div>
          {copyArea}
        </div>
        <div>
          <p className="text-sm font-medium text-text mb-2">Or share this raw token:</p>
          <pre className="text-xs font-mono bg-background border border-border rounded-lg px-4 py-3 whitespace-pre-wrap break-all text-text-muted">
            {token}
          </pre>
        </div>
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

  return (
    <div className="max-w-lg mx-auto">
      <div className="bg-surface rounded-xl border border-border p-8 shadow-sm">
        <h1 className="text-2xl font-bold text-text mb-2">Invite a new member</h1>
        <p className="text-sm text-text-muted mb-6">
          Create an invite token to bring a new person into the community. Share
          it with them so they can register.
        </p>
        <button
          onClick={handleCreateInvite}
          className="inline-flex items-center px-6 py-2.5 text-sm font-semibold text-text-inverse bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm hover:shadow transition-all duration-150"
        >
          Create an invite
        </button>
        {successArea}
        {errorArea}
      </div>
    </div>
  )
}

export default InvitePage
