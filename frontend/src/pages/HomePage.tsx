import { useRef, useState } from 'react'
import { Link } from 'react-router'

import { sendSampleEndpointRequest } from '../services/sampleEndpointService'
import { sendLogoutRequest } from '../services/authService'
import { formatApiResult } from '../utils/formatApiResult'

function HomePage() {
  // Counts requests so an older response cannot overwrite a newer one.
  const latestRequestNumber = useRef(0)

  // Holds the text of the latest request sent to the backend. Starts empty.
  const [apiRequest, setApiRequest] = useState('')

  // Holds the text of the latest backend response. Starts empty.
  const [apiResult, setApiResult] = useState('')

  // Track whether a member is logged in by reading localStorage.
  const [memberName, setMemberName] = useState(
    window.localStorage.getItem('memberName') ?? '',
  )

  // Sends one POST to the sample endpoint and saves the response for display.
  // bodyText must already be a JSON string.
  async function sendToSampleEndpoint(bodyText: string) {
    latestRequestNumber.current = latestRequestNumber.current + 1
    const requestNumber = latestRequestNumber.current
    setApiRequest(bodyText)
    setApiResult('Waiting for backend response...')
    const result = await sendSampleEndpointRequest(bodyText)
    if (requestNumber !== latestRequestNumber.current) {
      return
    }
    if (result.errorMessage !== '') {
      setApiResult(result.errorMessage)
    } else {
      setApiResult(formatApiResult(result.ok, result.status, result.data))
    }
  }

  // Sends a valid body. baz is the current unix time in seconds, like PHP's time().
  async function handleGoodClick() {
    const currentTime = Math.floor(Date.now() / 1000)
    const requestBody = {
      foo: 'bar',
      baz: currentTime,
    }
    await sendToSampleEndpoint(JSON.stringify(requestBody))
  }

  // Sends an invalid body. baz should be a number, so this text triggers a 422 error.
  async function handleBadClick() {
    const requestBody = {
      foo: 'bar',
      baz: 'not-a-number',
    }
    await sendToSampleEndpoint(JSON.stringify(requestBody))
  }

  // Sends text that is not valid JSON at all. The closing brace is missing.
  // FastAPI rejects this while parsing the body, before Pydantic ever runs.
  async function handleMalformedClick() {
    const brokenJsonText = '{"foo": "bar", "baz": 123'
    await sendToSampleEndpoint(brokenJsonText)
  }

  async function handleLogout() {
    await sendLogoutRequest()
    window.localStorage.removeItem('memberId')
    window.localStorage.removeItem('memberName')
    window.localStorage.removeItem('memberEmail')
    setMemberName('')
  }

  // Decide what the request box should show.
  let requestDisplayText = apiRequest
  if (requestDisplayText === '') {
    requestDisplayText = 'No request sent yet. Click a button above.'
  }

  // Decide what the response box should show.
  let responseDisplayText = apiResult
  if (responseDisplayText === '') {
    responseDisplayText = 'No response yet. Click a button above.'
  }

  // Show login or logout depending on whether a member is logged in.
  let authArea
  if (memberName !== '') {
    authArea = (
      <p>
        Logged in as {memberName}.{' '}
        <Link to="/dashboard">Go to dashboard</Link>{' '}
        <Link to="/invite">Invite a new member</Link>{' '}
        <button onClick={handleLogout}>Log out</button>
      </p>
    )
  } else {
    authArea = (
      <p>
        <Link to="/login">Go to login page</Link>
      </p>
    )
  }

  return (
    <>
      <h1>ICS 613 Team 4: Homepage</h1>
	  <p>test</p>
      <p>
        <Link to="/about">Go to about page</Link>
      </p>
      <p>
        <Link to="/register">Go to register page</Link>
      </p>
      {authArea}
      <button onClick={handleGoodClick}>Call backend API with valid JSON</button>
      <button onClick={handleBadClick}>Call backend API with wrong type</button>
      <button onClick={handleMalformedClick}>Call backend API with malformed JSON</button>
      <h2>Sent to backend</h2>
      <pre style={{ border: '1px solid black', padding: '10px', whiteSpace: 'pre-wrap' }}>
        {requestDisplayText}
      </pre>
      <h2>Backend response</h2>
      <pre style={{ border: '1px solid black', padding: '10px', whiteSpace: 'pre-wrap' }}>
        {responseDisplayText}
      </pre>
    </>
  )
}

export default HomePage

