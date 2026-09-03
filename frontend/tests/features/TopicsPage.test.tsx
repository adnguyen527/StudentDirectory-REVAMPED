import { HttpResponse, http } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { currentLocation, renderApp } from '../support/renderApp'
import { DECIMALS, DECIMALS_TWO, FRACTIONS } from '../support/sampleData'
import { server } from '../support/server'

function manyTopics(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    ...FRACTIONS,
    _id: { $oid: String(i).padStart(24, '0') },
    topic_id: `T-${String(i).padStart(3, '0')}`,
    name: `Topic ${String(i).padStart(3, '0')}`,
    also_known_as: [] as string[],
  }))
}

function tableRows() {
  return within(screen.getByRole('table')).getAllByRole('row').slice(1)
}

function filterBox() {
  return screen.getByRole('searchbox', { name: /search topics/i })
}

/** The id under each topic name, which is what tells two same-named topics apart. */
function topicIds() {
  return tableRows().map((row) => within(row).getByText(/^[A-Z]+-\d+$/).textContent)
}

describe('topics page', () => {
  it('shows the figures a topic list is read for', async () => {
    renderApp('/topics')

    const row = await screen.findByRole('row', { name: /Fractions/ })
    // By position, not by text: several of these columns hold the same number on this
    // row, so a text query would be ambiguous about which column it proved.
    const cells = within(row).getAllByRole('cell').map((cell) => cell.textContent)
    expect(cells).toEqual(['FractionsT-100', '9', '3', '2', '1', '0', '3', '1'])
  })

  it('leads with the most worked topic and says so', async () => {
    // The API decides the order; what this holds is that the page renders it as given
    // rather than re-sorting, and that the header does not go on claiming name order.
    renderApp('/topics')

    await screen.findByRole('row', { name: /Fractions/ })
    const first = tableRows()[0]
    expect(within(first).getByRole('link')).toHaveTextContent('Fractions')
    expect(screen.getByText(/most worked first/i)).toBeInTheDocument()
  })

  it('shows the id, which is the only thing separating two topics of the same name', async () => {
    // 90 real names are carried by more than one topic. Without the id these two rows
    // are indistinguishable and the page looks like it is repeating itself.
    renderApp('/topics')

    await screen.findByText(DECIMALS.topic_id)
    expect(screen.getByText(DECIMALS_TWO.topic_id)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Decimals' })).toHaveLength(2)
  })

  it('shows a dash rather than a zero when nobody has finished a topic', async () => {
    // median_sessions_to_finish is null there, and zero would claim they finished it
    // instantly.
    renderApp('/topics')

    const row = await screen.findByRole('row', { name: new RegExp(DECIMALS_TWO.topic_id) })
    expect(within(row).getByText('—')).toBeInTheDocument()
  })

  it('filters as you type and puts the term in the URL', async () => {
    const { user } = renderApp('/topics')
    await screen.findByRole('row', { name: /Fractions/ })

    await user.type(filterBox(), 'Angles')

    await waitFor(() => expect(currentLocation()).toBe('/topics?query=Angles'))
    await waitFor(() => expect(tableRows()).toHaveLength(1))
    expect(screen.getByRole('link', { name: 'Angles' })).toBeInTheDocument()
  })

  it('finds a topic by a name it no longer goes by', async () => {
    // The whole reason also_known_as is stored and searched.
    const { user } = renderApp('/topics')
    await screen.findByRole('row', { name: /Fractions/ })

    await user.type(filterBox(), 'Halves')

    await waitFor(() => expect(tableRows()).toHaveLength(1))
    expect(screen.getByRole('link', { name: 'Fractions' })).toBeInTheDocument()
  })

  it('finds a topic by its id', async () => {
    const { user } = renderApp('/topics')
    await screen.findByRole('row', { name: /Fractions/ })

    await user.type(filterBox(), 'T-115')

    await waitFor(() => expect(tableRows()).toHaveLength(1))
    expect(screen.getByText(DECIMALS_TWO.topic_id)).toBeInTheDocument()
  })

  it('takes its filter from the URL and fills the box in', async () => {
    renderApp('/topics?query=Angles')

    expect(await screen.findByRole('link', { name: 'Angles' })).toBeInTheDocument()
    await waitFor(() => expect(tableRows()).toHaveLength(1))
    expect(filterBox()).toHaveValue('Angles')
    expect(screen.getByText(/1 matching/)).toBeInTheDocument()
  })

  it('drops the offset when the filter changes', async () => {
    // Page 2 of the filtered list is not page 2 of the whole, and keeping the offset
    // lands the reader past the end of a short result.
    const { user } = renderApp('/topics?offset=50')

    await user.type(filterBox(), 'Angles')

    await waitFor(() => expect(currentLocation()).toBe('/topics?query=Angles'))
  })

  it('clears its filter from the header, as the other two lists do', async () => {
    // The box can be emptied by hand, but the three list headers should not each offer a
    // different way out of a filtered list.
    const { user } = renderApp('/topics?query=Angles')
    await screen.findByRole('link', { name: 'Angles' })

    await user.click(screen.getByRole('button', { name: /clear filter/i }))

    await waitFor(() => expect(currentLocation()).toBe('/topics'))
    expect(filterBox()).toHaveValue('')
  })

  it('sorts by a column, most first', async () => {
    const { user } = renderApp('/topics')
    await screen.findByRole('link', { name: 'Fractions' })

    await user.click(screen.getByRole('button', { name: 'Students' }))

    await waitFor(() => expect(currentLocation()).toBe('/topics?sort=students&direction=desc'))
  })

  it('keeps the topics with no median at the bottom, either way round', async () => {
    // Null is not zero and not "instant": 109 of 771 real topics have never been
    // finished, and an ascending sort that led with them would bury the answer.
    const { user } = renderApp('/topics')
    await screen.findByRole('button', { name: 'Median sessions' })
    // Re-queried per click: the table is replaced while the next request is in flight.
    // Exact, because the cell also holds a filter trigger naming the same column.
    const header = () => screen.getByRole('button', { name: 'Median sessions' })

    await user.click(header())
    await waitFor(() => expect(currentLocation()).toBe('/topics?sort=median&direction=desc'))
    await waitFor(() => expect(topicIds()).toEqual(['T-100', 'T-110', 'T-200', 'T-115']))

    await user.click(header())
    await waitFor(() => expect(currentLocation()).toBe('/topics?sort=median&direction=asc'))
    await waitFor(() => expect(topicIds()).toEqual(['T-200', 'T-110', 'T-100', 'T-115']))
  })

  it('breaks a tie on the id, so a paged list cannot repeat a row', async () => {
    // Two topics are called Decimals, as 90 real names are carried by more than one.
    const { user } = renderApp('/topics')
    await screen.findByRole('link', { name: 'Fractions' })

    await user.click(screen.getByRole('button', { name: 'Topic' }))

    await waitFor(() => expect(topicIds()).toEqual(['T-200', 'T-110', 'T-115', 'T-100']))
  })

  it('warns that a median range leaves out the topics that have none', async () => {
    // 109 of 771 real topics have never been finished, so no range can match them. The
    // filter is right to drop them and wrong to do it silently.
    const { user } = renderApp('/topics')
    await screen.findByRole('link', { name: 'Fractions' })

    await user.click(screen.getByRole('button', { name: /filter by median sessions/i }))

    expect(await screen.findByText(/nobody has finished have no median/i)).toBeInTheDocument()
  })

  it('filters topics by a count range', async () => {
    const { user } = renderApp('/topics')
    await screen.findByRole('link', { name: 'Fractions' })

    await user.click(screen.getByRole('button', { name: /filter by students/i }))
    await user.type(screen.getByRole('spinbutton', { name: /minimum students/i }), '2')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(currentLocation()).toBe('/topics?students_min=2'))
    await waitFor(() => expect(topicIds()).toEqual(['T-100', 'T-110']))
  })

  it('opens a topic by id from the list', async () => {
    const { user } = renderApp('/topics')
    await user.click(await screen.findByRole('link', { name: 'Fractions' }))

    await waitFor(() => expect(currentLocation()).toBe('/topics/T-100'))
  })

  it('pages through the URL', async () => {
    server.use(
      http.get('/api/topics', ({ request }) => {
        const url = new URL(request.url)
        const limit = Number(url.searchParams.get('limit') ?? 50)
        const offset = Number(url.searchParams.get('offset') ?? 0)
        const all = manyTopics(60)
        const rows = all.slice(offset, offset + limit)
        return HttpResponse.json({
          topics: rows,
          page: { limit, offset, total: all.length, returned: rows.length },
        })
      }),
    )
    const { user } = renderApp('/topics')

    expect(await screen.findByText('1–50 of 60')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => expect(currentLocation()).toBe('/topics?offset=50'))
    expect(await screen.findByText('51–60 of 60')).toBeInTheDocument()
  })

  it('says no match without looking like a failure', async () => {
    renderApp('/topics?query=nothing')

    expect(await screen.findByText(/No topics match/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reports a failed request instead of an empty list', async () => {
    server.use(
      http.get('/api/topics', () => HttpResponse.json({ error: 'Unauthorized' }, { status: 401 })),
    )
    renderApp('/topics')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Error 401')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
