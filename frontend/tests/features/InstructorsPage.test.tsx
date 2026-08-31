import { HttpResponse, http } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { currentLocation, renderApp } from '../support/renderApp'
import { DANA, DANA_LIST, MARCUS } from '../support/sampleData'
import { server } from '../support/server'

function manyInstructors(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    ...DANA_LIST,
    _id: { $oid: String(i).padStart(24, '0') },
    instructor_name: `Instructor ${String(i).padStart(3, '0')}`,
  }))
}

function tableRows() {
  return within(screen.getByRole('table')).getAllByRole('row').slice(1)
}

describe('instructors page', () => {
  it('shows the figures an instructor list is read for', async () => {
    renderApp('/instructors')

    const dana = await screen.findByRole('row', { name: new RegExp(DANA) })
    expect(within(dana).getByText('Westside')).toBeInTheDocument()
    // Teaches at two centers; the count stands in for the ones not listed.
    expect(within(dana).getByText('+1')).toBeInTheDocument()
    expect(within(dana).getByText('Mar 14, 2026')).toBeInTheDocument()
  })

  it('flags outstanding reports but not a clean record', async () => {
    // Unfinalized is a to-do, not a statistic -- so one is called out and zero is not.
    renderApp('/instructors')

    const dana = await screen.findByRole('row', { name: new RegExp(DANA) })
    expect(within(dana).getByText('1')).toHaveClass('tag-warn')

    const marcus = screen.getByRole('row', { name: new RegExp(MARCUS) })
    expect(within(marcus).getByText('0')).not.toHaveClass('tag-warn')
  })

  it('shows a dash when an instructor has no center', async () => {
    server.use(
      http.get('/api/instructors', () =>
        HttpResponse.json({
          instructors: [{ ...DANA_LIST, centers: [] }],
          page: { limit: 50, offset: 0, total: 1, returned: 1 },
        }),
      ),
    )
    renderApp('/instructors')

    const row = await screen.findByRole('row', { name: new RegExp(DANA) })
    expect(within(row).getByText('—')).toBeInTheDocument()
  })

  it('takes its filter from the URL', async () => {
    renderApp('/instructors?query=Marcus')

    expect(await screen.findByRole('row', { name: new RegExp(MARCUS) })).toBeInTheDocument()
    await waitFor(() => expect(tableRows()).toHaveLength(1))
    expect(screen.getByText(/1 matching/)).toBeInTheDocument()
  })

  it('clears the filter and the offset together', async () => {
    const { user } = renderApp('/instructors?query=Marcus&offset=0')
    await screen.findByRole('row', { name: new RegExp(MARCUS) })

    await user.click(screen.getByRole('button', { name: /clear filter/i }))

    await waitFor(() => expect(currentLocation()).toBe('/instructors'))
    expect(await screen.findByRole('row', { name: new RegExp(DANA) })).toBeInTheDocument()
  })

  it('opens an instructor by name from the list', async () => {
    const { user } = renderApp('/instructors')
    await user.click(await screen.findByRole('link', { name: DANA }))

    await waitFor(() => expect(currentLocation()).toBe('/instructors/Dana%20Reyes'))
  })

  it('pages through the URL', async () => {
    server.use(
      http.get('/api/instructors', ({ request }) => {
        const url = new URL(request.url)
        const limit = Number(url.searchParams.get('limit') ?? 50)
        const offset = Number(url.searchParams.get('offset') ?? 0)
        const all = manyInstructors(60)
        const rows = all.slice(offset, offset + limit)
        return HttpResponse.json({
          instructors: rows,
          page: { limit, offset, total: all.length, returned: rows.length },
        })
      }),
    )
    const { user } = renderApp('/instructors')

    expect(await screen.findByText('1–50 of 60')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => expect(currentLocation()).toBe('/instructors?offset=50'))
    expect(await screen.findByText('51–60 of 60')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
  })

  it('drops the offset from the URL when paging back to the first page', async () => {
    server.use(
      http.get('/api/instructors', ({ request }) => {
        const url = new URL(request.url)
        const limit = Number(url.searchParams.get('limit') ?? 50)
        const offset = Number(url.searchParams.get('offset') ?? 0)
        const all = manyInstructors(60)
        const rows = all.slice(offset, offset + limit)
        return HttpResponse.json({
          instructors: rows,
          page: { limit, offset, total: all.length, returned: rows.length },
        })
      }),
    )
    const { user } = renderApp('/instructors?offset=50')

    expect(await screen.findByText('51–60 of 60')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /previous/i }))

    await waitFor(() => expect(currentLocation()).toBe('/instructors'))
  })

  it('says no match without looking like a failure', async () => {
    renderApp('/instructors?query=nobody')

    expect(await screen.findByText(/No instructors match/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reports a failed request instead of an empty list', async () => {
    server.use(
      http.get('/api/instructors', () =>
        HttpResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      ),
    )
    renderApp('/instructors')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Error 401')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
