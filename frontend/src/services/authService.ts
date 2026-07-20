// API calls for registration, login, and logout.

export const authTimeoutMilliseconds = 3000

// Name of the same-tab event fired after code clears stored credentials without
// navigating (a stale-session 401). The shared nav listens for it so it can flip
// to the logged-out view. It lives here, exported as one constant, so the name
// is written once instead of retyped as a raw string in several files. A typo in
// a literal would fail silently: the listener would just never run.
export const authStateChangedEventName = "auth-state-changed"

// Clear the stored login and tell the rest of the app. Call this when an API
// call comes back 401, which means the stored member id is missing, malformed,
// or unknown. RequireAuth listens for the event and shows the log-in message,
// and the nav listens and flips to the logged-out links, so a caller does not
// need to render anything itself.
export function clearStoredLogin() {
  window.localStorage.removeItem('memberId')
  window.localStorage.removeItem('memberName')
  window.localStorage.removeItem('memberEmail')
  window.dispatchEvent(new Event(authStateChangedEventName))
}

export type AuthResult = {
  ok: boolean
  status: number
  data: unknown
  errorMessage: string
}

export async function sendRegisterRequest(
  name: string,
  email: string,
  password: string,
  inviteToken: string,
): Promise<AuthResult> {
  const requestBody = {
    name: name,
    email: email,
    password: password,
    invite_token: inviteToken,
  }

  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      // Cancel the request if the backend takes too long to answer.
      signal: AbortSignal.timeout(authTimeoutMilliseconds),
    })

    const responseText = await response.text()
    let data: unknown = ''
    if (responseText !== '') {
      try {
        data = JSON.parse(responseText)
      } catch {
        // If a proxy or server problem returns plain text or HTML, keep the
        // HTTP status and show the body instead of throwing it away.
        data = responseText
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data: data,
      errorMessage: '',
    }
  } catch (caughtError) {
    // Without this catch, a timeout or network failure would print
    // "Uncaught (in promise)" in the console instead of showing on the page.
    let errorMessage: string
    if (caughtError instanceof DOMException && caughtError.name === 'TimeoutError') {
      errorMessage =
        'Timeout: no answer from the backend after ' + authTimeoutMilliseconds + ' ms.'
    } else {
      errorMessage = 'Request failed: ' + String(caughtError)
    }

    return {
      ok: false,
      status: 0,
      data: '',
      errorMessage: errorMessage,
    }
  }
}

export async function sendLoginRequest(
  email: string,
  password: string,
): Promise<AuthResult> {
  const requestBody = {
    email: email,
    password: password,
  }

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(authTimeoutMilliseconds),
    })

    const responseText = await response.text()
    let data: unknown = ''
    if (responseText !== '') {
      try {
        data = JSON.parse(responseText)
      } catch {
        data = responseText
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data: data,
      errorMessage: '',
    }
  } catch (caughtError) {
    let errorMessage: string
    if (caughtError instanceof DOMException && caughtError.name === 'TimeoutError') {
      errorMessage =
        'Timeout: no answer from the backend after ' + authTimeoutMilliseconds + ' ms.'
    } else {
      errorMessage = 'Request failed: ' + String(caughtError)
    }

    return {
      ok: false,
      status: 0,
      data: '',
      errorMessage: errorMessage,
    }
  }
}

export async function sendLogoutRequest(): Promise<AuthResult> {
  try {
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(authTimeoutMilliseconds),
    })

    const responseText = await response.text()
    let data: unknown = ''
    if (responseText !== '') {
      try {
        data = JSON.parse(responseText)
      } catch {
        data = responseText
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      data: data,
      errorMessage: '',
    }
  } catch (caughtError) {
    let errorMessage: string
    if (caughtError instanceof DOMException && caughtError.name === 'TimeoutError') {
      errorMessage =
        'Timeout: no answer from the backend after ' + authTimeoutMilliseconds + ' ms.'
    } else {
      errorMessage = 'Request failed: ' + String(caughtError)
    }

    return {
      ok: false,
      status: 0,
      data: '',
      errorMessage: errorMessage,
    }
  }
}
