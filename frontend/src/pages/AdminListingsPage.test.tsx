// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import AdminListingsPage from './AdminListingsPage'

type FakeResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
}

function makeFakeResponse(ok: boolean, status: number, body: unknown): FakeResponse {
  const bodyText = body === '' ? '' : JSON.stringify(body)
  return {
    ok,
    status,
    text: async () => bodyText,
  }
}

function inventoryBody() {
  return [
    {
      id: 'active-1',
      owner_id: 'owner-1',
      owner_name: 'Olivia Owner',
      title: 'Fresh Tomatoes',
      status: 'active',
      deactivated_by: null,
    },
    {
      id: 'deactivated-1',
      owner_id: 'owner-2',
      owner_name: 'Bob Baker',
      title: 'Kabocha Squash',
      status: 'deactivated',
      deactivated_by: 'admin-1',
    },
  ]
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

test('shows all listings with state-appropriate admin actions', async () => {
  window.localStorage.setItem('memberId', 'admin-1')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, inventoryBody()))

  render(<AdminListingsPage />)

  expect(await screen.findByText('Fresh Tomatoes')).toBeTruthy()
  expect(screen.getByText('Kabocha Squash')).toBeTruthy()
  expect(screen.getByText('Olivia Owner')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Deactivate Fresh Tomatoes' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Reactivate Kabocha Squash' })).toBeTruthy()
})

test('does not offer reactivation for a listing that is not deactivated', async () => {
  window.localStorage.setItem('memberId', 'admin-1')
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, [
    {
      id: 'expired-1',
      owner_id: 'owner-1',
      owner_name: 'Olivia Owner',
      title: 'Expired Tomatoes',
      status: 'expired',
      deactivated_by: null,
    },
  ]))

  render(<AdminListingsPage />)

  expect(await screen.findByText('Expired Tomatoes')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /Expired Tomatoes/ })).toBeNull()
  expect(screen.getByText('expired')).toBeTruthy()
})

test('disables every listing action while one update is pending', async () => {
  window.localStorage.setItem('memberId', 'admin-1')
  vi.stubGlobal('confirm', () => true)
  let resolveUpdate: ((response: FakeResponse) => void) | undefined
  let updateRequests = 0
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options?: RequestInit) => {
    if (options?.method === 'POST') {
      updateRequests += 1
      return new Promise<FakeResponse>((resolve) => {
        resolveUpdate = resolve
      })
    }
    return makeFakeResponse(true, 200, inventoryBody())
  })

  render(<AdminListingsPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Deactivate Fresh Tomatoes' }))

  const otherAction = screen.getByRole('button', { name: 'Reactivate Kabocha Squash' }) as HTMLButtonElement
  expect(otherAction.disabled).toBe(true)
  fireEvent.click(otherAction)
  expect(updateRequests).toBe(1)

  resolveUpdate?.(makeFakeResponse(true, 204, ''))
  expect(await screen.findByText('Fresh Tomatoes deactivated.')).toBeTruthy()
  expect(otherAction.disabled).toBe(false)
})

test('reactivates a deactivated listing and updates its available action', async () => {
  window.localStorage.setItem('memberId', 'admin-1')
  vi.stubGlobal('confirm', () => true)
  const requestedUrls: string[] = []
  vi.stubGlobal('fetch', async (url: string | URL | Request, options?: RequestInit) => {
    const urlText = String(url)
    requestedUrls.push(urlText)
    if (options?.method === 'POST') {
      return makeFakeResponse(true, 204, '')
    }
    return makeFakeResponse(true, 200, inventoryBody())
  })

  render(<AdminListingsPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Reactivate Kabocha Squash' }))

  await waitFor(() => {
    expect(requestedUrls).toContain('/api/admin/listings/deactivated-1/reactivate')
  })
  expect(await screen.findByText('Kabocha Squash reactivated.')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Deactivate Kabocha Squash' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Reactivate Kabocha Squash' })).toBeNull()
})
