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

/** The first cell of each row, in the order served -- which is what a sort changes. */
function firstColumn() {
  return tableRows().map((row) => within(row).getAllByRole('cell')[0].textContent)
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

  it('filters from its own box, in place of the card title', async () => {
    const { user } = renderApp('/instructors')
    await screen.findByRole('row', { name: new RegExp(DANA) })

    await user.type(screen.getByRole('searchbox', { name: /search instructors/i }), 'Marcus')

    await waitFor(() => expect(currentLocation()).toBe('/instructors?query=Marcus'))
    await waitFor(() => expect(tableRows()).toHaveLength(1))
    expect(screen.getByRole('row', { name: new RegExp(MARCUS) })).toBeInTheDocument()
  })

  it('shows the filter it arrived with in the box', async () => {
    renderApp('/instructors?query=Marcus')

    await screen.findByRole('row', { name: new RegExp(MARCUS) })
    expect(screen.getByRole('searchbox', { name: /search instructors/i })).toHaveValue('Marcus')
  })

  it('filters by center from the dropdown, and says so on the trigger', async () => {
    const { user } = renderApp('/instructors')
    await screen.findByRole('row', { name: new RegExp(DANA) })

    // Closed, the trigger has to say the list is unfiltered.
    const trigger = screen.getByRole('button', { name: /all centers/i })
    await user.click(trigger)
    await user.click(await screen.findByRole('checkbox', { name: 'Eastside' }))

    await waitFor(() => expect(currentLocation()).toBe('/instructors?center=Eastside'))
    expect(screen.getByRole('button', { name: /Eastside/ })).toBeInTheDocument()
  })

  it('returns an instructor at two centers once when both are ticked', async () => {
    // Dana works at Westside and Eastside, as 11 of the 103 real instructors work at more
    // than one. The union is not a partition: she must appear once, not twice.
    const { user } = renderApp('/instructors')
    await screen.findByRole('row', { name: new RegExp(DANA) })

    await user.click(screen.getByRole('button', { name: /all centers/i }))
    await user.click(await screen.findByRole('checkbox', { name: 'Westside' }))
    await user.click(await screen.findByRole('checkbox', { name: 'Eastside' }))

    await waitFor(() =>
      expect(currentLocation()).toBe('/instructors?center=Westside&center=Eastside'),
    )
    // Both ticked, so the trigger counts rather than naming one.
    expect(screen.getByRole('button', { name: /2 centers/ })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getAllByRole('row', { name: new RegExp(DANA) })).toHaveLength(1),
    )
  })

  it('drops the offset when the center selection changes', async () => {
    const { user } = renderApp('/instructors?offset=50')

    await user.click(await screen.findByRole('button', { name: /all centers/i }))
    await user.click(await screen.findByRole('checkbox', { name: 'Eastside' }))

    await waitFor(() => expect(currentLocation()).toBe('/instructors?center=Eastside'))
  })

  it('closes the panel on Escape and on a click outside it', async () => {
    const { user } = renderApp('/instructors')
    await screen.findByRole('row', { name: new RegExp(DANA) })

    await user.click(screen.getByRole('button', { name: /all centers/i }))
    expect(await screen.findByRole('checkbox', { name: 'Eastside' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: 'Eastside' })).not.toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: /all centers/i }))
    await screen.findByRole('checkbox', { name: 'Eastside' })
    await user.click(document.body)

    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: 'Eastside' })).not.toBeInTheDocument(),
    )
  })

  it('clears the filter and the offset together', async () => {
    const { user } = renderApp('/instructors?query=Marcus&offset=0')
    await screen.findByRole('row', { name: new RegExp(MARCUS) })

    await user.click(screen.getByRole('button', { name: /clear filter/i }))

    await waitFor(() => expect(currentLocation()).toBe('/instructors'))
    expect(await screen.findByRole('row', { name: new RegExp(DANA) })).toBeInTheDocument()
  })

  it('offers to clear a center filter, not just a search term', async () => {
    const { user } = renderApp('/instructors?center=Eastside')
    await screen.findByRole('row', { name: new RegExp(DANA) })

    await user.click(screen.getByRole('button', { name: /clear filter/i }))

    await waitFor(() => expect(currentLocation()).toBe('/instructors'))
    expect(screen.getByRole('button', { name: /all centers/i })).toBeInTheDocument()
  })

  it('offers nothing to clear when only the page has moved', async () => {
    renderApp('/instructors?offset=50')

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /clear filter/i })).not.toBeInTheDocument(),
    )
  })

  it('sorts by a column the API derives rather than stores', async () => {
    // Students is $size of an array the list response does not carry -- the header
    // cannot tell, and must not have to.
    const { user } = renderApp('/instructors')
    await screen.findByRole('row', { name: new RegExp(DANA) })

    await user.click(screen.getByRole('button', { name: 'Students' }))

    await waitFor(() =>
      expect(currentLocation()).toBe('/instructors?sort=students&direction=desc'),
    )
    await waitFor(() => expect(firstColumn()).toEqual([DANA, MARCUS]))
  })

  it('sorts and filters at once rather than one replacing the other', async () => {
    const { user } = renderApp('/instructors?center=Westside')
    await screen.findByRole('row', { name: new RegExp(DANA) })

    await user.click(screen.getByRole('button', { name: 'Unfinalized' }))

    await waitFor(() =>
      expect(currentLocation()).toBe(
        '/instructors?center=Westside&sort=unfinalized&direction=desc',
      ),
    )
    // Both instructors are at Westside, so the filter holds while the order changes.
    await waitFor(() => expect(firstColumn()).toEqual([DANA, MARCUS]))
  })

  it('filters instructors by a count range from the header', async () => {
    // Dana has 4 sessions, Marcus 1.
    const { user } = renderApp('/instructors')
    await screen.findByRole('row', { name: new RegExp(DANA) })

    await user.click(screen.getByRole('button', { name: /filter by sessions/i }))
    await user.type(screen.getByRole('spinbutton', { name: /minimum sessions/i }), '2')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(currentLocation()).toBe('/instructors?sessions_min=2'))
    await waitFor(() => expect(firstColumn()).toEqual([DANA]))
  })

  it('has no filter on the columns the API cannot bound', async () => {
    // Students and Days are counted from arrays at query time, so a range on them would
    // have to size every document in the collection to match one. They sort; they do not
    // filter, and the header must not offer what the API will not do.
    renderApp('/instructors')
    await screen.findByRole('row', { name: new RegExp(DANA) })

    expect(screen.queryByRole('button', { name: /filter by students/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /filter by days/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /filter by sessions/i })).toBeInTheDocument()
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
