import { expect, test } from 'vitest'

import { formatApiResult } from './formatApiResult'

test('formats a success response', () => {
  const data = {
    message: 'Payload accepted',
    baz: 123,
  }
  const resultText = formatApiResult(true, 200, data)
  expect(resultText).toBe('Success (HTTP 200)\n{\n  "message": "Payload accepted",\n  "baz": 123\n}')
})

test('formats an error response', () => {
  const data = {
    detail: 'JSON decode error',
  }
  const resultText = formatApiResult(false, 422, data)
  expect(resultText).toBe('Error (HTTP 422)\n{\n  "detail": "JSON decode error"\n}')
})

test('shows a plain text body unchanged', () => {
  // Covers the string branch: a proxy or server problem that answers
  // with text or HTML instead of JSON.
  const resultText = formatApiResult(false, 502, 'Bad Gateway')
  expect(resultText).toBe('Error (HTTP 502)\nBad Gateway')
})
