// Builds the text shown in the response box: an outcome line plus the response body.
// data is typed "unknown" because a response body can hold many shapes.
export function formatApiResult(ok: boolean, status: number, data: unknown): string {
  let bodyText: string
  if (typeof data === 'string') {
    bodyText = data
  } else {
    // JSON.stringify's extra arguments pretty-print with 2-space indents,
    // like JSON_PRETTY_PRINT in PHP's json_encode.
    bodyText = JSON.stringify(data, null, 2)
  }

  let outcome: string
  if (ok) {
    outcome = 'Success'
  } else {
    outcome = 'Error'
  }
  return outcome + ' (HTTP ' + status + ')\n' + bodyText
}
