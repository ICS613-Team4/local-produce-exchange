import { useRef, useState } from 'react'

import { sendSampleEndpointRequest } from '../services/sampleEndpointService'
import { formatApiResult } from '../utils/formatApiResult'

function TestPage() {
  // Counts requests so an older response cannot overwrite a newer one.
  const latestRequestNumber = useRef(0)

  // Holds the text of the latest request sent to the backend. Starts empty.
  const [apiRequest, setApiRequest] = useState('')

  // Holds the text of the latest backend response. Starts empty.
  const [apiResult, setApiResult] = useState('')

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

  return (
    <section>
      <h1>Test Page</h1>
      <p>
        Use the buttons below to call the sample backend endpoint and see the raw
        request and response. This page is a development tool and is open to
        everyone, logged in or not.
      </p>
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
    </section>
  )
}

export default TestPage
