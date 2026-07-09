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
    <div className="max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-text mb-2">Test Page</h1>
      <p className="text-sm text-text-muted mb-6">
        Use the buttons below to call the sample backend endpoint and see the raw
        request and response. This page is a development tool and is open to
        everyone, logged in or not.
      </p>

      <div className="flex flex-wrap gap-3 mb-8">
        <button
          onClick={handleGoodClick}
          className="px-5 py-2.5 text-sm font-semibold text-text-inverse bg-primary-600 rounded-lg hover:bg-primary-700 shadow-sm transition-all duration-150"
        >
          Valid JSON
        </button>
        <button
          onClick={handleBadClick}
          className="px-5 py-2.5 text-sm font-medium text-warning border border-amber-200 rounded-lg hover:bg-warning-bg transition-colors"
        >
          Wrong type
        </button>
        <button
          onClick={handleMalformedClick}
          className="px-5 py-2.5 text-sm font-medium text-error border border-red-200 rounded-lg hover:bg-error-bg transition-colors"
        >
          Malformed JSON
        </button>
      </div>

      <div className="space-y-6">
        <div className="bg-surface rounded-xl border border-border p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-text uppercase tracking-wide mb-3">Sent to backend</h2>
          <pre className="text-xs font-mono bg-background border border-border rounded-lg px-4 py-3 whitespace-pre-wrap text-text-muted overflow-x-auto">
            {requestDisplayText}
          </pre>
        </div>

        <div className="bg-surface rounded-xl border border-border p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-text uppercase tracking-wide mb-3">Backend response</h2>
          <pre className="text-xs font-mono bg-background border border-border rounded-lg px-4 py-3 whitespace-pre-wrap text-text-muted overflow-x-auto">
            {responseDisplayText}
          </pre>
        </div>
      </div>
    </div>
  )
}

export default TestPage
