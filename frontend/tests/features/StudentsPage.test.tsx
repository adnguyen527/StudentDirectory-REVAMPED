import { HttpResponse, http } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { currentLocation, renderApp } from '../support/renderApp'
import { ANTHONY, ANTHONY_KEY } from '../support/sampleData'
import { server } from '../support/server'

/** A page's worth of students, for the cases three fixtures cannot reach. */
function manyStudents(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    ...ANTHONY,
    _id: { $oid: String(i).padStart(24, '0') },
    student_key: `key-${i}`,
    student_name: `Student ${String(i).padStart(3, '0')}`,
  }))
}

function tableRows() {
  return within(screen.getByRole('table')).getAllByRole('row').slice(1)
}

describe('students page', () => {
  it('shows a row per student with the figures a list is read for', async () => {
    renderApp('/students')

    const anthony = await screen.findByRole('row', { name: /Anthony Nguyen/ })
    expect(within(anthony).getByText('Westside')).toBeInTheDocument()
    // Sessions, topics finished, on plan.
    expect(within(anthony).getByText('2')).toBeInTheDocument()
    // The date renders as a date, in UTC -- not "[object Object]" and not a day early.
    expect(within(anthony).getByText('Mar 14, 2026')).toBeInTheDocument()
  })

  it('takes its filter from the URL, so a search result is linkable', async () => {
    renderApp('/students?query=Chloe')

    expect(await screen.findByRole('row', { name: /Chloe Tan/ })).toBeInTheDocument()
    await waitFor(() => expect(tableRows()).toHaveLength(1))
    expect(screen.getByText(/1 matching/)).toBeInTheDocument()
  })

  it('clears the filter and the offset together', async () => {
    // Page 2 of a filtered list is not page 2 of the whole one.
    const { user } = renderApp('/students?query=Chloe&offset=0')
    await screen.findByRole('row', { name: /Chloe Tan/ })

    await user.click(screen.getByRole('button', { name: /clear filter/i }))

    await waitFor(() => expect(currentLocation()).toBe('/students'))
    expect(await screen.findByRole('row', { name: /Anthony Nguyen/ })).toBeInTheDocument()
  })

  it('opens a student from their name in the list', async () => {
    const { user } = renderApp('/students')
    await user.click(await screen.findByRole('link', { name: 'Anthony Nguyen' }))

    await waitFor(() => {
      expect(currentLocation()).toBe(`/students/${encodeURIComponent(ANTHONY_KEY)}`)
    })
  })

  it('pages through the URL, so Back steps between pages', async () => {
    server.use(
      http.get('/api/students', ({ request }) => {
        const url = new URL(request.url)
        const limit = Number(url.searchParams.get('limit') ?? 50)
        const offset = Number(url.searchParams.get('offset') ?? 0)
        const all = manyStudents(60)
        const rows = all.slice(offset, offset + limit)
        return HttpResponse.json({
          students: rows,
          page: { limit, offset, total: all.length, returned: rows.length },
        })
      }),
    )
    const { user } = renderApp('/students')

    expect(await screen.findByText('1–50 of 60')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => expect(currentLocation()).toBe('/students?offset=50'))
    expect(await screen.findByText('51–60 of 60')).toBeInTheDocument()
    // Ten rows on the short last page, and nowhere further to go.
    await waitFor(() => expect(tableRows()).toHaveLength(10))
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
  })

  it('drops the offset from the URL when paging back to the first page', async () => {
    // ?offset=0 is noise: page one is the bare path, so a shared link is the clean one.
    server.use(
      http.get('/api/students', ({ request }) => {
        const url = new URL(request.url)
        const limit = Number(url.searchParams.get('limit') ?? 50)
        const offset = Number(url.searchParams.get('offset') ?? 0)
        const all = manyStudents(60)
        const rows = all.slice(offset, offset + limit)
        return HttpResponse.json({
          students: rows,
          page: { limit, offset, total: all.length, returned: rows.length },
        })
      }),
    )
    const { user } = renderApp('/students?offset=50')

    expect(await screen.findByText('51–60 of 60')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /previous/i }))

    await waitFor(() => expect(currentLocation()).toBe('/students'))
  })

  it('says no match, which must not look like a failure', async () => {
    renderApp('/students?query=nobody')

    expect(await screen.findByText(/No students match/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says what went wrong when the request fails, and shows no table', async () => {
    // The failure worth designing for: a 500 rendering as an empty list reads as
    // "no students".
    server.use(
      http.get('/api/students', () =>
        HttpResponse.json(
          {
            error: 'Server is not configured for authentication',
            detail: 'Set API_KEY in .env -- see .env.example',
          },
          { status: 500 },
        ),
      ),
    )
    renderApp('/students')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Error 500')
    expect(alert).toHaveTextContent('Set API_KEY in .env')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
