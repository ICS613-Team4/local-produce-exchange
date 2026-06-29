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

  function buildMessage(msg: MessageData) {
    return (
      <li key={msg.id} style={{ marginBottom: '0.75rem' }}>
        <strong>{msg.sender_name}</strong>{' '}
        <small>{formatTimestamp(msg.sent_at)}</small>
        <br />
        {msg.body}
      </li>
    )
  }

  const timeZoneNote = getLocalTimeZoneNote()

  let content
  if (memberId === '') {
    content = <p role="alert">{notLoggedInMessage}</p>
  } else if (claimId === '') {
    content = <p role="alert">No exchange specified. Try navigating here from a request page.</p>
  } else if (loadError !== '') {
    content = <p role="alert">{loadError}</p>
  } else if (thread === null) {
    content = <p>Loading exchange thread...</p>
  } else {
    const messageList =
      thread.messages.length === 0 ? (
        <p>No messages yet. Start the conversation below.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {thread.messages.map(buildMessage)}
        </ul>
      )

    content = (
      <>
        {messageList}
        <p>
          <small>{timeZoneNote}</small>
        </p>
        <hr />
        <form onSubmit={handleSend}>
          <label htmlFor="message-body">
            <strong>Send a message</strong>
          </label>
          <br />
          <textarea
            id="message-body"
            rows={4}
            cols={60}
            maxLength={MESSAGE_MAX_LENGTH}
            value={messageBody}
            onChange={(e) => setMessageBody(e.target.value)}
            disabled={sending}
            placeholder="Type your message here…"
          />
          <br />
          {sendError !== '' && <p role="alert">{sendError}</p>}
          <button type="submit" disabled={sending}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </form>
      </>
    )
  }

  return (
    <section>
      <h1>Exchange Thread</h1>
      <p>
        <Link to="/my-requests">← Back to My Requests</Link>
      </p>
      {content}
    </section>
  )
}

export default ExchangeThreadPage
