// Formats a timezone-aware ISO timestamp for display, and reports the viewer's
// own time zone so the page can tell the user the times are in their local time.
//
// The backend sends pickup times as ISO strings that carry a timezone offset,
// like "2026-07-01T09:00:00.000Z". new Date() reads that offset and gives us a
// real point in time. toLocaleString() then renders it in the browser's own
// locale and the viewer's local time zone. We pass timeZoneName: "short" so the
// result ends with the zone's short name (like "HST", "PST", or "CEST"). That
// short name is the convention sites such as Google Calendar use to show which
// zone a time is in, and since it is the viewer's own detected zone, it doubles
// as the signal that the time is their local time.
//
// If the string is missing or cannot be parsed, we return it unchanged instead
// of showing "Invalid Date", so a bad value is still visible for debugging.
export function formatTimestamp(isoString: string): string {
  if (isoString === '') {
    return ''
  }
  const parsedDate = new Date(isoString)
  const milliseconds = parsedDate.getTime()
  if (Number.isNaN(milliseconds)) {
    return isoString
  }
  const formatOptions = { timeZoneName: 'short' as const }
  return parsedDate.toLocaleString(undefined, formatOptions)
}

// Returns the viewer's IANA time zone name, like "Pacific/Honolulu" or
// "America/Los_Angeles". The page shows this in a one-line note so the user
// knows, in plain words, that the listing times are in their own local zone.
// If the browser cannot report a zone for some reason, we return an empty
// string and the page leaves the zone name out of its note.
export function getLocalTimeZoneName(): string {
  const resolvedOptions = Intl.DateTimeFormat().resolvedOptions()
  const timeZoneName = resolvedOptions.timeZone
  if (timeZoneName === undefined) {
    return ''
  }
  return timeZoneName
}

// Builds the one-line note that tells the viewer the times on the page are in
// their own local time zone, naming the zone when the browser can report it.
// Every page that shows timestamps uses this so the wording is identical.
export function getLocalTimeZoneNote(): string {
  const timeZoneName = getLocalTimeZoneName()
  if (timeZoneName === '') {
    return 'All times are shown in your local time zone.'
  }
  return 'All times are shown in your local time zone (' + timeZoneName + ').'
}
