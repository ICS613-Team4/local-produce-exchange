import { expect, test } from 'vitest'

import { formatTimestamp, getLocalTimeZoneName } from './formatTimestamp'

test('formats a timezone-aware ISO string in the local locale with the zone name', () => {
  // We build the expected text the same way the helper does, so this passes on
  // any machine's locale or time zone instead of hardcoding one format.
  const isoString = '2026-07-01T09:00:00.000Z'
  const timeZoneOptions = { timeZoneName: 'short' as const }
  const expectedText = new Date(isoString).toLocaleString(undefined, timeZoneOptions)
  const resultText = formatTimestamp(isoString)
  expect(resultText).toBe(expectedText)
})

test('reports a non-empty IANA time zone name for the running environment', () => {
  // The exact zone depends on the machine, so we only check the helper returns
  // the same value the browser reports, which the page shows in its note.
  const expectedZoneName = Intl.DateTimeFormat().resolvedOptions().timeZone
  const resultZoneName = getLocalTimeZoneName()
  expect(resultZoneName).toBe(expectedZoneName)
})

test('returns an empty string unchanged', () => {
  const resultText = formatTimestamp('')
  expect(resultText).toBe('')
})

test('returns an unparseable string unchanged instead of "Invalid Date"', () => {
  const resultText = formatTimestamp('not a date')
  expect(resultText).toBe('not a date')
})
