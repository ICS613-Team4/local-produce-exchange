// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import InvitePage from './InvitePage'

type FakeResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
}

// Unmount components, restore the real fetch, and clear localStorage after
// every test, so one test cannot leak into the next.
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

// Renders the page inside an in-memory router. The Link needs one.
function renderInvitePage() {
  render(
    <MemoryRouter>
      <InvitePage />
    </MemoryRouter>,
  )
}

// Builds a fake fetch result with only the members InvitePage reads.
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

test('shows the create button when a member is logged in', () => {
  window.localStorage.setItem('memberId', 'member-123')
  renderInvitePage()

  expect(screen.getByRole('button', { name: 'Create an invite' })).toBeTruthy()
})

test('shows the token and the shown-once note after a successful create', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  const responseBody = {
    id: 'row-1',
    token: 'fresh-token-abc',
    status: 'pending',
    expires_at: null,
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 201, responseBody)
  })

  renderInvitePage()
  fireEvent.click(screen.getByRole('button', { name: 'Create an invite' }))

  // findByText waits for the state update that follows the fake fetch.
  const tokenBox = await screen.findByText('fresh-token-abc')
  const shownOnceNote = screen.getByText(/shown once/)

  expect(tokenBox).toBeTruthy()
  expect(shownOnceNote).toBeTruthy()
})

test('shows the shareable link with the token after a successful create', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  const responseBody = {
    id: 'row-1',
    token: 'fresh-token-abc',
    status: 'pending',
    expires_at: null,
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 201, responseBody)
  })

  renderInvitePage()
  fireEvent.click(screen.getByRole('button', { name: 'Create an invite' }))

  // The page builds the link from window.location.origin, so the test reads
  // the same origin instead of hardcoding a host.
  const expectedLink =
    window.location.origin + '/register?token=' + encodeURIComponent('fresh-token-abc')
  const linkBox = await screen.findByText(expectedLink)

  expect(linkBox.textContent).toContain('/register?token=')
  expect(linkBox.textContent).toContain('fresh-token-abc')
})

test('shows the backend error message on a failed create', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  const responseBody = {
    detail: 'Your account is suspended, so you cannot create invites.',
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(false, 403, responseBody)
  })

  renderInvitePage()
  fireEvent.click(screen.getByRole('button', { name: 'Create an invite' }))

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toBe('Your account is suspended, so you cannot create invites.')
})

test('shows a please-log-in message and no create button when not logged in', () => {
  // localStorage has no memberId, so the page treats this as not logged in.
  renderInvitePage()

  expect(screen.getByText('Please log in to create an invite.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Create an invite' })).toBeNull()
})

test('shows the transport error message when the request times out', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  vi.stubGlobal('fetch', async () => {
    throw new DOMException('The operation timed out.', 'TimeoutError')
  })

  renderInvitePage()
  fireEvent.click(screen.getByRole('button', { name: 'Create an invite' }))

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toContain('Timeout: no answer from the backend')
})

test('shows a fallback message when the error body has no detail', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  vi.stubGlobal('fetch', async () => {
    const fakeResponse = {
      ok: false,
      status: 502,
      text: async () => {
        return 'Bad Gateway'
      },
    }
    return fakeResponse
  })

  renderInvitePage()
  fireEvent.click(screen.getByRole('button', { name: 'Create an invite' }))

  const errorArea = await screen.findByRole('alert')
  expect(errorArea.textContent).toBe('Could not create an invite (HTTP 502).')
})

test('copies the shareable link when the copy button is clicked', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  const responseBody = {
    id: 'row-1',
    token: 'fresh-token-abc',
    status: 'pending',
    expires_at: null,
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 201, responseBody)
  })

  // jsdom has no real clipboard, so stand in a fake one that records the text.
  let copiedText = ''
  const fakeClipboard = {
    writeText: async (text: string) => {
      copiedText = text
    },
  }
  Object.defineProperty(window.navigator, 'clipboard', {
    value: fakeClipboard,
    configurable: true,
  })

  renderInvitePage()
  fireEvent.click(screen.getByRole('button', { name: 'Create an invite' }))
  const copyButton = await screen.findByRole('button', { name: 'Copy link' })
  fireEvent.click(copyButton)

  const copiedNote = await screen.findByText('Link copied.')
  expect(copiedNote).toBeTruthy()
  const expectedLink =
    window.location.origin + '/register?token=' + encodeURIComponent('fresh-token-abc')
  expect(copiedText).toBe(expectedLink)
})

test('shows a fallback note when copying to the clipboard fails', async () => {
  window.localStorage.setItem('memberId', 'member-123')
  const responseBody = {
    id: 'row-1',
    token: 'fresh-token-abc',
    status: 'pending',
    expires_at: null,
  }
  vi.stubGlobal('fetch', async () => {
    return makeFakeResponse(true, 201, responseBody)
  })

  // A clipboard that always rejects, to drive the catch branch.
  const fakeClipboard = {
    writeText: async () => {
      throw new Error('Clipboard blocked')
    },
  }
  Object.defineProperty(window.navigator, 'clipboard', {
    value: fakeClipboard,
    configurable: true,
  })

  renderInvitePage()
  fireEvent.click(screen.getByRole('button', { name: 'Create an invite' }))
  const copyButton = await screen.findByRole('button', { name: 'Copy link' })
  fireEvent.click(copyButton)

  const copiedNote = await screen.findByText(
    'Could not copy automatically. Please copy the link by hand.',
  )
  expect(copiedNote).toBeTruthy()
})
