import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'

import { getThread, sendMessage } from '../services/threadService'
import type { MessageData, ThreadData } from '../services/threadService'
import { authStateChangedEventName } from '../services/authService'
import { formatTimestamp, getLocalTimeZoneNote } from '../utils/formatTimestamp'

const notLoggedInMessage = 'You need to be logged in to view this exchange thread.'
const MESSAGE_MAX_LENGTH = 2000

function ExchangeThreadPage() {
  const location = useLocation()
  const claimId = new URLSearchParams(location.search).get('claim') ?? ''

  const latestRequestNumber = useRef(0)
  const [memberId] = useState(window.localStorage.getItem('memberId') ?? '')
  const [thread, setThread] = useState<ThreadData | null>(null)
  const [loadError, setLoadError] = useState('')
  const [reloadCounter, setReloadCounter] = useState(0)

  const [messageBody, setMessageBody] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')

  // Load the thread whenever the page mounts or a message is sent.
  useEffect(() => {
    latestRequestNumber.current = latestRequestNumber.current + 1
    if (memberId === '' || claimId === '') {
      return
    }
    const requestNumber = latestRequestNumber.current
    async function loadThread() {
      const result = await getThread(memberId, claimId)
      if (requestNumber !== latestRequestNumber.current) {
        return
      }
      if (result.status === 401) {
        window.localStorage.removeItem('memberId')
        window.localStorage.removeItem('memberName')
        window.localStorage.removeItem('memberEmail')
        window.dispatchEvent(new Event(authStateChangedEventName))
        return
      }
      if (result.errorMessage !== '') {
        setLoadError(result.errorMessage)
        return
      }
      if (result.ok) {
        setThread(result.data as ThreadData)
        setLoadError('')
      } else {
        let detail = 'Could not load this exchange thread. Please try again.'
        if (typeof result.data === 'object' && result.data !== null) {
          const d = result.data as { detail?: unknown }
          if (typeof d.detail === 'string') detail = d.detail
        }
        setLoadError(detail)
      }
    }
    loadThread()
  }, [memberId, claimId, reloadCounter])

  async function handleSend(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = messageBody.trim()
    if (trimmed === '') {
      setSendError('Message cannot be empty.')
      return
    }
    setSending(true)
    setSendError('')

    const result = await sendMessage(memberId, claimId, trimmed)
    setSending(false)

    if (result.errorMessage !== '') {
      setSendError(result.errorMessage)
      return
    }
    if (result.ok) {
      setMessageBody('')
      setReloadCounter((c) => c + 1)
    } else {
      let detail = 'Could not send the message. Please try again.'
      if (typeof result.data === 'object' && result.data !== null) {
        const d = result.data as { detail?: unknown }
        if (typeof d.detail === 'string') detail = d.detail
      }
      setSendError(detail)
    }
  }

  // One chat row. The viewer's own messages sit on the right in the primary
  // green; the other member's messages sit on the left in the neutral bubble.
  // The sender name always shows so a reloaded thread stays readable.
  function buildMessage(msg: MessageData) {
    const isOwnMessage = msg.sender_id === memberId
    let rowClasses = 'flex flex-col items-start'
    let bubbleClasses =
      'max-w-[75%] rounded-2xl rounded-bl-md bg-background-alt px-4 py-2.5 text-sm text-text whitespace-pre-wrap break-words'
    if (isOwnMessage) {
      rowClasses = 'flex flex-col items-end'
      bubbleClasses =
        'max-w-[75%] rounded-2xl rounded-br-md bg-primary-600 px-4 py-2.5 text-sm text-text-inverse whitespace-pre-wrap break-words'
    }
    return (
      <li key={msg.id} className={rowClasses}>
        <p className="text-xs text-text-muted mb-1">
          <span className="font-medium text-text">{msg.sender_name}</span>{' '}
          {formatTimestamp(msg.sent_at)}
        </p>
        <div className={bubbleClasses}>{msg.body}</div>
      </li>
    )
  }

  const timeZoneNote = getLocalTimeZoneNote()

  let content
  if (memberId === '') {
    content = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
        {notLoggedInMessage}
      </div>
    )
  } else if (claimId === '') {
    content = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
        No exchange specified. Try navigating here from a request page.
      </div>
    )
  } else if (loadError !== '') {
    content = (
      <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error" role="alert">
        {loadError}
      </div>
    )
  } else if (thread === null) {
    content = <p className="text-text-muted text-sm py-8 text-center">Loading exchange thread...</p>
  } else {
    const messageList =
      thread.messages.length === 0 ? (
        <p className="text-sm text-text-muted py-8 text-center">
          No messages yet. Start the conversation below.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">{thread.messages.map(buildMessage)}</ul>
      )

    content = (
      <div className="bg-surface rounded-xl border border-border shadow-sm">
        <div className="p-6">
          {messageList}
          <p className="text-xs text-text-muted mt-4">{timeZoneNote}</p>
        </div>
        <div className="border-t border-border p-6">
          <form onSubmit={handleSend}>
            <label htmlFor="message-body" className="block text-sm font-semibold text-text mb-2">
              Send a message
            </label>
            <textarea
              id="message-body"
              rows={4}
              maxLength={MESSAGE_MAX_LENGTH}
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              disabled={sending}
              placeholder="Type your message here…"
              className="w-full px-4 py-2.5 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-150 resize-y disabled:opacity-50 disabled:cursor-not-allowed"
            />
            {sendError !== '' && (
              <div className="rounded-lg bg-error-bg border border-red-200 px-4 py-3 text-sm text-error mt-3" role="alert">
                {sendError}
              </div>
            )}
            <div className="flex justify-end mt-3">
              <button
                type="submit"
                disabled={sending}
                className="px-6 py-2.5 text-sm font-semibold text-text-inverse bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <p className="mb-2">
          <Link
            to="/my-requests"
            className="inline-flex items-center text-sm font-medium text-primary-600 hover:text-primary-700"
          >
            ← Back to My Requests
          </Link>
        </p>
        <h1 className="text-3xl font-bold text-text">Exchange Thread</h1>
      </div>
      {content}
    </div>
  )
}

export default ExchangeThreadPage
