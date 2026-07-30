// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, test, vi } from 'vitest'

import ReportMemberPage from './ReportMemberPage'
import type { MemberData } from '../services/memberService'

type FakeResponse = {
  ok: boolean
  status: number
  text: () => Promise<string>
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

function renderPage(search = '?member=member-2') {
  window.localStorage.setItem('memberId', 'member-1')
  render(
    <MemoryRouter initialEntries={[`/report${search}`]}>
      <Routes>
        <Route path="/report" element={<ReportMemberPage />} />
        <Route path="/profile/:id" element={<div>Profile Page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function makeFakeResponse(ok: boolean, status: number, body: object | string): FakeResponse {
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body)
  return { ok, status, text: async () => bodyText }
}

function makeTarget(): MemberData {
  return {
    id: 'member-2',
    name: 'Bob Baker',
    email: 'bob@example.com',
    status: 'active',
    role: 'member',
    created_at: '2026-01-01T00:00:00.000Z',
    profile: { display_name: 'Bob Baker', contact_preference: null, neighborhood: null },
  }
}

test('shows an error when no member is specified', async () => {
  renderPage('')

  expect(await screen.findByText('No member specified.')).toBeTruthy()
})

test('loads the target member and shows the form', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeTarget()))

  renderPage()

  expect(await screen.findByText('Report Bob Baker')).toBeTruthy()
  expect(screen.getByLabelText('Reason')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Submit Report' }) as HTMLButtonElement).disabled).toBe(true)
})

test('submit is disabled until a category is chosen', async () => {
  vi.stubGlobal('fetch', async () => makeFakeResponse(true, 200, makeTarget()))
  renderPage()
  await screen.findByText('Report Bob Baker')

  const submitButton = screen.getByRole('button', { name: 'Submit Report' }) as HTMLButtonElement
  expect(submitButton.disabled).toBe(true)

  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'harassment' } })
  expect(submitButton.disabled).toBe(false)
})

test('submitting files the report and shows the confirmation', async () => {
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options?.method === 'POST') {
      return makeFakeResponse(true, 201, {
        id: 'report-1',
        target_member_id: 'member-2',
        category: 'harassment',
        detail: null,
        status: 'open',
        created_at: '2026-07-29T00:00:00.000Z',
      })
    }
    return makeFakeResponse(true, 200, makeTarget())
  })

  renderPage()
  await screen.findByText('Report Bob Baker')

  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'harassment' } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit Report' }))

  expect(await screen.findByText('Report Submitted')).toBeTruthy()
  const backLink = screen.getByRole('link', { name: 'Back to profile' })
  expect(backLink.getAttribute('href')).toBe('/profile/member-2')
})

test('a duplicate open report shows the server detail message', async () => {
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options?.method === 'POST') {
      return makeFakeResponse(false, 409, { detail: 'You already have an open report against this member.' })
    }
    return makeFakeResponse(true, 200, makeTarget())
  })

  renderPage()
  await screen.findByText('Report Bob Baker')

  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'harassment' } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit Report' }))

  await waitFor(() => {
    expect(screen.getByRole('alert').textContent).toBe('You already have an open report against this member.')
  })
})

test('a 401 on submit clears the stored login', async () => {
  vi.stubGlobal('fetch', async (_url: string | URL | Request, options: RequestInit | undefined) => {
    if (options?.method === 'POST') {
      return makeFakeResponse(false, 401, {})
    }
    return makeFakeResponse(true, 200, makeTarget())
  })

  renderPage()
  await screen.findByText('Report Bob Baker')

  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'harassment' } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit Report' }))

  await waitFor(() => {
    expect(window.localStorage.getItem('memberId')).toBeNull()
  })
})
