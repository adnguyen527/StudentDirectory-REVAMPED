import { HttpResponse, http } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { currentLocation, renderApp } from '../support/renderApp'
import { DANA, DANA_DETAIL } from '../support/sampleData'
import { server } from '../support/server'

const PROFILE = `/instructors/${encodeURIComponent(DANA)}`

/** The duplicate-name pair the fixture carries, and the reason topic ids are on screen. */
const DUPLICATE = 'Word Problems – Multi-Step'

async function topicsCard(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: /most-taught topics/i })
  return heading.closest('.card') as HTMLElement
}

/** Serve Dana's detail with her topics replaced -- or removed entirely. */
function serveTopics(topics: typeof DANA_DETAIL.topics) {
  server.use(
    http.get('/api/instructors/:instructorName', () => {
      const { topics: _dropped, ...rest } = DANA_DETAIL
      return HttpResponse.json({
        instructor: topics === undefined ? rest : { ...rest, topics },
      })
    }),
  )
}

describe('most-taught topics', () => {
  it('opens on the ten most taught and counts the rest in its title', async () => {
    // The card's title asks what they teach most, so it opens on the answer rather than on
    // thirteen rows -- 504 on the widest real instructor.
    renderApp(PROFILE)

    const card = within(await topicsCard())
    await waitFor(() => expect(card.getAllByRole('row')).toHaveLength(11)) // header + 10

    expect(
      await screen.findByRole('heading', { name: /most-taught topics · 13/i }),
    ).toBeInTheDocument()
    expect(card.getByText(/their 10 most taught, of 13/i)).toBeInTheDocument()
    // Nothing to page while only the top ten is on screen -- that view is complete as it is.
    expect(card.queryByRole('button', { name: /next/i })).not.toBeInTheDocument()
  })

  it('ranks by sessions, breaking ties alphabetically', async () => {
    // The order the builder writes, `(-sessions, name)`. Decimals before Fractions at two
    // sessions each is the same tie the Python fixture holds.
    renderApp(PROFILE)

    const card = within(await topicsCard())
    await waitFor(() => expect(card.getAllByRole('row')).toHaveLength(11))

    const names = card
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getByRole('link').textContent)

    expect(names.slice(0, 3)).toEqual(['Angles', DUPLICATE, 'Addition – Carrying'])
    expect(names.indexOf('Decimals')).toBeLessThan(names.indexOf('Fractions'))
  })

  it('tells two rows sharing a name apart by their ids', async () => {
    // ⚠️ The reason the id is rendered at all. 87 of 103 real instructors have a name
    // appearing twice in their own list; without the id those read as one row repeated
    // with contradictory session counts.
    renderApp(PROFILE)

    const card = within(await topicsCard())
    const rows = await waitFor(() => {
      const found = card.getAllByRole('link', { name: DUPLICATE })
      expect(found).toHaveLength(2)
      return found.map((link) => link.closest('tr') as HTMLElement)
    })

    expect(within(rows[0]).getByText('T-300')).toBeInTheDocument()
    expect(within(rows[1]).getByText('T-301')).toBeInTheDocument()
    // The counts that would look like a contradiction without the ids above.
    expect(within(rows[0]).getByText('4')).toBeInTheDocument()
    expect(within(rows[1]).getByText('2')).toBeInTheDocument()
  })

  it('links a row to that topic, by id rather than by name', async () => {
    const { user } = renderApp(PROFILE)

    const card = within(await topicsCard())
    const link = await waitFor(() => card.getAllByRole('link', { name: DUPLICATE })[1])

    await user.click(link)
    // T-301, the second of the pair -- a link keyed on the shared name could only ever
    // reach one of them.
    await waitFor(() => expect(currentLocation()).toBe('/topics/T-301'))
  })

  it('says the column does not total, and against which number', async () => {
    // ⚠️ A session covers several topics, so these sum past the Sessions tile at the top of
    // the same page. Left unsaid, the two read as a contradiction in the data.
    renderApp(PROFILE)

    const card = within(await topicsCard())
    expect(
      await card.findByText(/add to more than the 4 sessions they taught/i),
    ).toBeInTheDocument()
  })

  it('expands to the whole list and pages through it', async () => {
    const { user } = renderApp(PROFILE)

    const card = within(await topicsCard())
    await user.click(await card.findByRole('button', { name: /^show all$/i }))

    expect(await card.findByText('1–10 of 13')).toBeInTheDocument()
    expect(card.getByText(/all 13 topics they have taught/i)).toBeInTheDocument()

    await user.click(card.getByRole('button', { name: /next/i }))

    expect(await card.findByText('11–13 of 13')).toBeInTheDocument()
    expect(card.getAllByRole('row')).toHaveLength(4) // header + the three that are left
  })

  it('searches the full list by name and by id', async () => {
    // 13 rows is two pages; 504 is fifty. "Do they teach Fractions at all" is not a
    // question anyone answers by paging.
    const { user } = renderApp(PROFILE)

    const card = within(await topicsCard())
    await user.click(await card.findByRole('button', { name: /^show all$/i }))

    const box = card.getByRole('searchbox', { name: /search this instructor/i })
    await user.type(box, 'word problems')

    await waitFor(() => expect(card.getAllByRole('row')).toHaveLength(3)) // header + the pair
    expect(card.getByText(/2 of 13 topics/i)).toBeInTheDocument()

    await user.clear(box)
    await user.type(box, 'T-301')

    // The id finds the exact one of the pair that the shared name cannot.
    await waitFor(() => expect(card.getAllByRole('row')).toHaveLength(2))
    expect(card.getByRole('link', { name: DUPLICATE })).toBeInTheDocument()
  })

  it('says so when a search matches nothing', async () => {
    const { user } = renderApp(PROFILE)

    const card = within(await topicsCard())
    await user.click(await card.findByRole('button', { name: /^show all$/i }))
    await user.type(card.getByRole('searchbox', { name: /search this instructor/i }), 'zzz')

    expect(await card.findByText(/no topics match/i)).toBeInTheDocument()
  })

  it('collapses back to the top ten, dropping the search with it', async () => {
    // Reopening on page two of a search the reader has closed would be a surprise, and the
    // top ten is not a subset of anything -- it has to be the top ten.
    const { user } = renderApp(PROFILE)

    const card = within(await topicsCard())
    await user.click(await card.findByRole('button', { name: /^show all$/i }))
    await user.type(card.getByRole('searchbox', { name: /search this instructor/i }), 'rounding')
    await waitFor(() => expect(card.getAllByRole('row')).toHaveLength(2))

    await user.click(card.getByRole('button', { name: /show top 10/i }))

    await waitFor(() => expect(card.getAllByRole('row')).toHaveLength(11))
    expect(card.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(card.getByText(/their 10 most taught, of 13/i)).toBeInTheDocument()
  })

  it('offers neither control to a list that already fits', async () => {
    // A search box over three rows, and a "Show all" that shows what is already shown.
    serveTopics([
      { topic_id: 'T-100', name: 'Fractions', sessions: 2 },
      { topic_id: 'T-110', name: 'Decimals', sessions: 1 },
    ])
    renderApp(PROFILE)

    const card = within(await topicsCard())
    await waitFor(() => expect(card.getAllByRole('row')).toHaveLength(3))

    expect(card.queryByRole('button', { name: /show all/i })).not.toBeInTheDocument()
    expect(card.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(card.getByText(/all 2 topics they have taught/i)).toBeInTheDocument()
  })

  it('distinguishes a stale document from an instructor with no topics', async () => {
    // ⚠️ Absent is a missing answer; empty is an answer. Telling a document built before
    // the field existed that it has "no topics" would be the wrong one of the two.
    serveTopics(undefined)
    renderApp(PROFILE)

    const stale = within(await topicsCard())
    expect(await stale.findByText(/re-run/i)).toBeInTheDocument()
    expect(stale.getByText('ingestion/build_instructors.py')).toBeInTheDocument()
    // The title drops its count rather than claiming zero.
    expect(screen.getByRole('heading', { name: /^most-taught topics$/i })).toBeInTheDocument()
  })

  it('says plainly when nothing was recorded', async () => {
    serveTopics([])
    renderApp(PROFILE)

    const empty = within(await topicsCard())
    expect(await empty.findByText(/no topics were recorded/i)).toBeInTheDocument()
    expect(empty.queryByText(/re-run/i)).not.toBeInTheDocument()
  })
})
