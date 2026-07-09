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

test('reports the everyday time zone name, not the technical IANA id', () => {
  // The exact zone depends on the machine, so build the expected value the
  // same way the helper does: the long display name of today's zone.
  const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: 'long' }).formatToParts(
    new Date(),
  )
  let expectedZoneName = ''
  for (let index = 0; index < parts.length; index = index + 1) {
    if (parts[index].type === 'timeZoneName') {
      expectedZoneName = parts[index].value
    }
  }
  const resultZoneName = getLocalTimeZoneName()
  expect(resultZoneName).toBe(expectedZoneName)
  expect(resultZoneName).not.toBe('')
  // The everyday name has no slash, unlike IANA ids such as "America/Los_Angeles".
  expect(resultZoneName.includes('/')).toBe(false)
})

test('returns an empty string unchanged', () => {
  const resultText = formatTimestamp('')
  expect(resultText).toBe('')
})

test('returns an unparseable string unchanged instead of "Invalid Date"', () => {
  const resultText = formatTimestamp('not a date')
  expect(resultText).toBe('not a date')
})
