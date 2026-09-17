import { HttpResponse, http } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { currentLocation, renderApp } from '../support/renderApp'
import { server } from '../support/server'

/**
 * The activity card on the center metrics page: sessions over time, students by center and
 * instructors by center behind one selector.
 *
 * ⚠️ These three charts used to live above the students, instructors and reports lists, and
 * this file replaces both suites that tested them there. Some of what those files asserted
 * has no premise any more and is deliberately gone rather than re-pointed -- the chart no
 * longer follows a search box, a `sessions_min` bound or a sort header, because there is no
 * list here for it to agree with.
 *
 * Every assertion reads a chart's table twin; the marks are aria-hidden and carry no
 * geometry jsdom could report anyway.
 */

const PAGE = '/center-metrics'

/** The twin as [label, value] pairs, in the order the marks are drawn. */
async function chartRows(name: RegExp): Promise<[string, string][]> {
  const table = await screen.findByRole('table', { name })
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent ?? '')) as [
    string,
    string,
  ][]
}

/** The last intervals the chart asked for, so the bucket width can be checked. */
function recordInterval() {
  const seen: string[] = []
  server.use(
    http.get('/api/reports/trends', ({ request }) => {
      seen.push(new URL(request.url).searchParams.get('interval') ?? '')
      return HttpResponse.json({ interval: 'day', range: null, buckets: [] })
    }),
  )
  return seen
}

/** Open the card's own date filter and set a window through it. */
async function setWindow(
  user: ReturnType<typeof renderApp>['user'],
  from: string,
  to: string,
) {
  // ⚠️ Named "chart period", not "session date" -- the sessions card lower down the page
  // has a filter of its own and the label is what tells the two apart.
  await user.click(await screen.findByRole('button', { name: /filter by chart period/i }))
  const low = await screen.findByLabelText(/earliest chart period/i)
  await user.clear(low)
  if (from) await user.type(low, from)
  const high = await screen.findByLabelText(/latest chart period/i)
  await user.clear(high)
  if (to) await user.type(high, to)
  await user.click(screen.getByRole('button', { name: /^apply$/i }))
}

describe('center activity card', () => {
  it('opens on sessions over time, with no view in the URL', async () => {
    // The default costs no param: a URL should not carry state that changes nothing.
    renderApp(PAGE)

    expect(await chartRows(/sessions over time/i)).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Sessions' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(currentLocation()).toBe(PAGE)
  })

  it('opens on Any time rather than on a window nobody asked for', async () => {
    // ⚠️ Unlike the sessions card below it, which opens on its newest day. This one is a
    // shape over time, and a shape needs the whole span to be a shape at all.
    renderApp(PAGE)

    expect(
      await screen.findByRole('button', { name: /filter by chart period: any time/i }),
    ).toBeInTheDocument()
  })

  it('switches views, and the choice travels in the URL', async () => {
    const { user } = renderApp(PAGE)

    await user.click(await screen.findByRole('button', { name: 'Students' }))
    await waitFor(() => expect(currentLocation()).toContain('view=students'))
    expect(await chartRows(/students by center/i)).toEqual([
      ['Westside', '2'],
      ['Eastside', '1'],
    ])

    await user.click(screen.getByRole('button', { name: 'Instructors' }))
    await waitFor(() => expect(currentLocation()).toContain('view=instructors'))

    // Back to the default drops the param rather than spelling it out.
    await user.click(screen.getByRole('button', { name: 'Sessions' }))
    await waitFor(() => expect(currentLocation()).not.toContain('view'))
  })

  it('opens on the view the URL names', async () => {
    renderApp(`${PAGE}?view=instructors`)

    expect(await chartRows(/instructors by center/i)).not.toHaveLength(0)
  })

  it('falls back to sessions when the URL names a view that does not exist', async () => {
    // A hand-edited URL should show the default, not a blank card.
    renderApp(`${PAGE}?view=nonsense`)

    expect(await chartRows(/sessions over time/i)).not.toHaveLength(0)
  })

  it('counts an instructor at two centers under each, and says so', async () => {
    // ⚠️ The assertion this chart's note exists for. Dana works at both centers, so two
    // bars carry one person and they sum above the roster.
    renderApp(`${PAGE}?view=instructors`)

    expect(await chartRows(/instructors by center/i)).toEqual([
      ['Westside', '2'],
      ['Eastside', '1'],
    ])
    expect(
      await screen.findByText(/3 center appearances across 2 instructors/i),
    ).toBeInTheDocument()
  })

  it('says only the plain total when nobody spans two centers', async () => {
    renderApp(`${PAGE}?view=students`)

    await chartRows(/students by center/i)
    expect(screen.queryByText(/center appearances/i)).not.toBeInTheDocument()
  })

  it('narrows every view to the selected center', async () => {
    // The whole reason the card sits on this page: CenterBar scopes it as it scopes the
    // tiles, where on the old list pages it followed that list's own filters.
    const { user } = renderApp(`${PAGE}?center=Eastside&view=students`)

    expect(await chartRows(/students by center/i)).toEqual([['Eastside', '1']])

    await user.click(screen.getByRole('button', { name: 'Sessions' }))
    // Of the two sessions on 14 March, one is at Eastside.
    await waitFor(async () =>
      expect(await chartRows(/sessions over time/i)).toContainEqual(['14 Mar 2026', '1']),
    )
  })

  it('counts every center when none is picked', async () => {
    const { user } = renderApp(PAGE)

    await setWindow(user, '2026-03-14', '2026-03-14')

    expect(await chartRows(/sessions over time/i)).toEqual([['14 Mar 2026', '2']])
  })

  it('fills the quiet buckets rather than leaving holes', async () => {
    const { user } = renderApp(PAGE)

    await setWindow(user, '2026-03-07', '2026-03-14')

    // The window is eight days and only two of them carry a session, so six buckets are
    // zeroes -- and every one of them has to be drawn. The axis follows the window asked
    // for, not the days that happened to match.
    await waitFor(async () => {
      const rows = await chartRows(/sessions over time/i)
      expect(rows).toHaveLength(8)
      expect(rows.filter(([, count]) => count === '0')).toHaveLength(6)
    })
  })

  it('widens the bucket as the window grows, so the axis stays readable', async () => {
    const seen = recordInterval()
    const { user } = renderApp(PAGE)

    await setWindow(user, '2026-03-01', '2026-03-14')
    await waitFor(() => expect(seen).toContain('day'))

    // Past ~10 weeks the daily axis stops being readable, so it widens.
    await setWindow(user, '2026-01-01', '2026-06-30')
    await waitFor(() => expect(seen).toContain('week'))

    await setWindow(user, '2024-08-09', '2026-03-14')
    await waitFor(() => expect(seen).toContain('month'))
  })

  it('states the window it is showing, and the bucket it is using', async () => {
    // Three months is past the daily axis's readable width, so it answers in weeks -- and
    // says so, since "4 sessions" means something different per day than per week.
    const { user } = renderApp(PAGE)

    await setWindow(user, '2026-01-01', '2026-03-31')

    expect(await screen.findByText(/4 sessions by week/i)).toBeInTheDocument()
  })

  it('explains a dimmed bucket rather than letting it read as a quiet week', async () => {
    // ⚠️ The window is used exactly as asked rather than widened to whole buckets, so an
    // edge bar can be short because the window is. Without the note that reads as a decline.
    server.use(
      http.get('/api/reports/trends', () =>
        HttpResponse.json({
          interval: 'week',
          range: {
            start: { $date: '2026-02-01T00:00:00Z' },
            end: { $date: '2026-02-14T00:00:00Z' },
          },
          buckets: [
            {
              key: '2026-W05',
              start: { $date: '2026-01-26T00:00:00Z' },
              end: { $date: '2026-02-01T00:00:00Z' },
              partial: true,
              sessions: 1,
            },
            {
              key: '2026-W06',
              start: { $date: '2026-02-02T00:00:00Z' },
              end: { $date: '2026-02-08T00:00:00Z' },
              partial: false,
              sessions: 4,
            },
          ],
        }),
      ),
    )

    renderApp(PAGE)

    expect(await screen.findByText(/only part covered by this period/i)).toBeInTheDocument()
    // ⚠️ And the twin says *which week* W05 was, not just that it was partial. "W05" alone
    // answers "which week?" with nothing, which is the whole reason the hint exists.
    expect(await chartRows(/sessions over time/i)).toEqual([
      ['26 Jan – 1 Feb 2026 (partial)', '1'],
      ['2–8 Feb 2026', '4'],
    ])
  })

  it('reads an open-ended window against the newest session at these centers', async () => {
    // ⚠️ An open end is not an unknown window. A preset sets only a start, and without
    // standing in the resolved end a three-week window asks for monthly buckets and draws
    // itself as a single bar.
    const seen = recordInterval()
    const { user } = renderApp(PAGE)

    await setWindow(user, '2026-02-20', '')

    // The fixtures' newest session is 2026-03-14, so this is a three-week window.
    await waitFor(() => expect(seen).toContain('day'))
    expect(seen).not.toContain('month')
  })
})

describe('the activity card and its date filter', () => {
  it('offers the filter on sessions and withholds it on the two distributions', async () => {
    /**
     * ⚠️ The decision this card is built around. `/api/students/distribution` does accept a
     * date range, but it bounds `last_session_date` -- "whose *last* session fell in this
     * window" -- which is not what a reader setting a period means. On the live data,
     * Jan–Mar 2025 read that way returns 79 students where 525 actually attended. So the
     * control is absent here rather than wired to a number that is wrong by 6x.
     */
    const { user } = renderApp(PAGE)

    expect(
      await screen.findByRole('button', { name: /filter by chart period/i }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Students' }))
    await chartRows(/students by center/i)
    expect(screen.queryByRole('button', { name: /filter by chart period/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Instructors' }))
    await chartRows(/instructors by center/i)
    expect(screen.queryByRole('button', { name: /filter by chart period/i })).not.toBeInTheDocument()
  })

  it('says on screen that a distribution view is all-time', async () => {
    // The filter being absent is not self-explanatory: without this line the reader has no
    // way to tell the window they set is simply not applied to these bars.
    renderApp(`${PAGE}?view=students`)

    expect(await screen.findByText(/all-time — this view is not dated/i)).toBeInTheDocument()
  })

  it('keeps the window while the reader looks at another view', async () => {
    // Switching views is not clearing the filter. The range is component state and the
    // views share the card, so it survives the round trip.
    const { user } = renderApp(PAGE)

    await setWindow(user, '2026-03-14', '2026-03-14')
    await waitFor(async () =>
      expect(await chartRows(/sessions over time/i)).toEqual([['14 Mar 2026', '2']]),
    )

    await user.click(screen.getByRole('button', { name: 'Students' }))
    await chartRows(/students by center/i)
    await user.click(screen.getByRole('button', { name: 'Sessions' }))

    expect(
      await screen.findByRole('button', { name: /filter by chart period: Mar 14, 2026/i }),
    ).toBeInTheDocument()
    expect(await chartRows(/sessions over time/i)).toEqual([['14 Mar 2026', '2']])
  })

  it('never puts the window in the address bar', async () => {
    // ⚠️ The same rule the sessions card on this page is already held to. The center
    // selection is the page's and is linkable; a card's own window is not.
    const { user } = renderApp(PAGE)

    await setWindow(user, '2026-03-10', '2026-03-14')
    await waitFor(async () =>
      expect(await chartRows(/sessions over time/i)).not.toHaveLength(0),
    )

    expect(currentLocation()).toBe(PAGE)
  })
})

describe('the activity card when a request fails', () => {
  it('reports a failed trend rather than drawing an empty period', async () => {
    server.use(http.get('/api/reports/trends', () => HttpResponse.json({}, { status: 500 })))

    renderApp(PAGE)

    const alerts = await screen.findAllByRole('alert')
    expect(alerts.some((alert) => alert.textContent?.includes('Error 500'))).toBe(true)
  })

  it('reports a failed distribution the same way', async () => {
    // A 500 rendering as a chart with no bars reads as "nobody is at any center".
    server.use(
      http.get('/api/students/distribution', () => HttpResponse.json({}, { status: 500 })),
    )

    renderApp(`${PAGE}?view=students`)

    const alerts = await screen.findAllByRole('alert')
    expect(alerts.some((alert) => alert.textContent?.includes('Error 500'))).toBe(true)
  })

  it('says so when a center has nobody in it', async () => {
    server.use(
      http.get('/api/students/distribution', () =>
        HttpResponse.json({ centers: [], distribution: [], counted: 0, total: 0, no_center: 0 }),
      ),
    )

    renderApp(`${PAGE}?view=students`)

    expect(await screen.findByText(/no students at these centers/i)).toBeInTheDocument()
  })
})
