// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import HomePage from './HomePage'

type FakeResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
}

// Unmount components and restore the real fetch after every test,
// so one test cannot leak into the next.
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// Renders the page inside an in-memory router. The Link needs one.
function renderHomePage() {
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  )
}

// Builds a fake fetch result with only the members HomePage reads.
function makeFakeResponse(ok: boolean, status: number, body: object): FakeResponse {
  const bodyText = JSON.stringify(body)
  const fakeResponse = {
    ok: ok,
    status: status,
    text: async () => {
      return bodyText
    },
  }
  return fakeResponse
}

function makePendingFetchResponse() {
  let resolveResponse: (response: FakeResponse) => void = () => {}
  const responsePromise = new Promise<FakeResponse>((resolve) => {
    resolveResponse = resolve
  })
  const pendingResponse = {
    responsePromise: responsePromise,
    resolveResponse: resolveResponse,
  }
  return pendingResponse
}

async function waitForStateUpdates() {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
}

test('shows a placeholder before any button is clicked', () => {
  renderHomePage()
  const requestPlaceholder = screen.getByText('No request sent yet. Click a button above.')
  const responsePlaceholder = screen.getByText('No response yet. Click a button above.')

  expect(requestPlaceholder).toBeTruthy()
  expect(responsePlaceholder).toBeTruthy()
})

test('shows the success text after a valid payload', async () => {
  const body = { message: 'Payload accepted', baz: 123 }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 200, body)
  })

  renderHomePage()
  fireEvent.click(screen.getByText('Call backend API with valid JSON'))

  // findByText waits for the state update that follows the fake fetch.
  const requestBox = screen.getByText(/"foo":"bar"/)
  const resultBox = await screen.findByText(/Success \(HTTP 200\)/)

  expect(requestBox.textContent).toContain('"baz":')
  expect(resultBox.textContent).toContain('Payload accepted')
})

test('shows the error text after a rejected payload', async () => {
  const body = { detail: [{ type: 'int_parsing', loc: ['body', 'baz'] }] }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 422, body)
  })

  renderHomePage()
  fireEvent.click(screen.getByText('Call backend API with wrong type'))

  const requestBox = screen.getByText(/"baz":"not-a-number"/)
  const resultBox = await screen.findByText(/Error \(HTTP 422\)/)

  expect(requestBox.textContent).toContain('"foo":"bar"')
  expect(resultBox.textContent).toContain('int_parsing')
})

test('shows the JSON parse error after malformed JSON', async () => {
  const body = { detail: [{ type: 'json_invalid', msg: 'JSON decode error' }] }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 422, body)
  })

  renderHomePage()
  fireEvent.click(screen.getByText('Call backend API with malformed JSON'))

  const requestBox = screen.getByText('{"foo": "bar", "baz": 123')
  const resultBox = await screen.findByText(/Error \(HTTP 422\)/)

  expect(requestBox).toBeTruthy()
  expect(resultBox.textContent).toContain('json_invalid')
})

test('does not let an older backend response overwrite a newer response', async () => {
  const firstResponse = makePendingFetchResponse()
  const secondResponse = makePendingFetchResponse()
  let callCount = 0
  vi.stubGlobal('fetch', () => {
    callCount = callCount + 1
    if (callCount === 1) {
      return firstResponse.responsePromise
    }
    return secondResponse.responsePromise
  })

  renderHomePage()
  fireEvent.click(screen.getByText('Call backend API with valid JSON'))
  fireEvent.click(screen.getByText('Call backend API with wrong type'))

  const secondBody = { detail: [{ type: 'int_parsing', loc: ['body', 'baz'] }] }
  secondResponse.resolveResponse(makeFakeResponse(false, 422, secondBody))

  const resultBox = await screen.findByText(/Error \(HTTP 422\)/)
  expect(resultBox.textContent).toContain('int_parsing')

  const firstBody = { message: 'Payload accepted', baz: 123 }
  firstResponse.resolveResponse(makeFakeResponse(true, 200, firstBody))
  await waitForStateUpdates()

  expect(resultBox.textContent).toContain('int_parsing')
  expect(resultBox.textContent).not.toContain('Payload accepted')
})

test('shows the timeout message when the request times out', async () => {
  vi.stubGlobal('fetch', async () => {
    // The same exception a real AbortSignal.timeout produces.
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  renderHomePage()
  fireEvent.click(screen.getByText('Call backend API with valid JSON'))

  const requestBox = screen.getByText(/"foo":"bar"/)
  const resultBox = await screen.findByText(/Timeout: no answer from the backend/)

  expect(requestBox.textContent).toContain('"baz":')
  expect(resultBox).toBeTruthy()
})
