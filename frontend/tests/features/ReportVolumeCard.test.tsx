import { HttpResponse, http } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { currentLocation, renderApp } from '../support/renderApp'
import { server } from '../support/server'

/**
 * The report-volume chart, above the reports list.
 *
 * Every assertion reads the chart's table twin; the marks are aria-hidden and carry no
 * geometry jsdom could report anyway.
 */

/** The twin as [bucket, sessions] pairs, in the order the columns are drawn. */
async function chartRows(): Promise<[string, string][]> {
  const table = await screen.findByRole('table', { name: /sessions over time/i })
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map(
      (row) => within(row).getAllByRole('cell').map((cell) => cell.textContent ?? ''),
    ) as [string, string][]
}

/** The last request the chart made, so the interval it asked for can be checked. */
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

describe('report volume chart', () => {
  it('is open on arrival', async () => {
    // Unlike the centre charts: this is the one list entered with a period in mind.
    renderApp('/reports')

    expect(await chartRows()).not.toHaveLength(0)
    expect(screen.getByRole('button', { name: /hide chart/i })).toBeInTheDocument()
  })

  it('counts the sessions in each bucket', async () => {
    // The fixture reports fall on 5 Jan, 10 Mar and twice on 14 Mar -- so the 14th is the
    // one bucket that has to show two, which a per-row count would get wrong.
    renderApp('/reports?date_from=2026-03-09&date_to=2026-03-15')

    // The twin names the day in full, as the hover does -- the terse form is the axis's.
    expect(await chartRows()).toEqual([
      ['9 Mar 2026', '0'],
      ['10 Mar 2026', '1'],
      ['11 Mar 2026', '0'],
      ['12 Mar 2026', '0'],
      ['13 Mar 2026', '0'],
      ['14 Mar 2026', '2'],
      ['15 Mar 2026', '0'],
    ])
  })

  it('fills the quiet buckets rather than leaving holes', async () => {
    renderApp('/reports?date_from=2026-03-07&date_to=2026-03-14')

    const rows = await chartRows()
    // The window is eight days and only two of them carry a session, so six buckets are
    // zeroes -- and every one of them has to be drawn. The axis follows the window asked
    // for, not the days that happened to match.
    expect(rows).toHaveLength(8)
    expect(rows.filter(([, count]) => count === '0')).toHaveLength(6)
  })

  // Two sessions fall on 14 March, one at each centre -- so the same day reads 2 unfiltered
  // and 1 at Eastside, which is what makes this pair worth having. Separate tests rather
  // than two renders in one: cleanup runs between tests, not between renders, so a second
  // renderApp leaves the first chart mounted and the query finds the stale one.
  it('counts every centre when none is picked', async () => {
    renderApp('/reports?date_from=2026-03-14&date_to=2026-03-14')

    expect(await chartRows()).toEqual([['14 Mar 2026', '2']])
  })

  it('narrows with the list it sits above', async () => {
    renderApp('/reports?center=Eastside&date_from=2026-03-14&date_to=2026-03-14')

    expect(await chartRows()).toEqual([['14 Mar 2026', '1']])
  })

  it('widens the bucket as the window grows, so the axis stays readable', async () => {
    const seen = recordInterval()

    renderApp('/reports?date_from=2026-03-01&date_to=2026-03-14')
    await waitFor(() => expect(seen).toContain('day'))

    // Past ~10 weeks the daily axis stops being readable, so it widens.
    renderApp('/reports?date_from=2026-01-01&date_to=2026-06-30')
    await waitFor(() => expect(seen).toContain('week'))

    renderApp('/reports?date_from=2024-08-09&date_to=2026-03-14')
    await waitFor(() => expect(seen).toContain('month'))
  })

  it('states the window it is showing, and the bucket it is using', async () => {
    // Three months is past the daily axis's readable width, so it answers in weeks -- and
    // says so, since "4 sessions" means something different per day than per week.
    renderApp('/reports?date_from=2026-01-01&date_to=2026-03-31')

    expect(await screen.findByText(/4 sessions by week/i)).toBeInTheDocument()
  })

  it('explains a dimmed bucket rather than letting it read as a quiet week', async () => {
    // ⚠️ The window is used exactly as asked rather than widened to whole buckets, so an
    // edge bar can be short because the window is. Without the note that reads as a decline.
    server.use(
      http.get('/api/reports/trends', () =>
        HttpResponse.json({
          interval: 'week',
          range: { start: { $date: '2026-02-01T00:00:00Z' }, end: { $date: '2026-02-14T00:00:00Z' } },
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

    renderApp('/reports?date_from=2026-02-01&date_to=2026-02-14')

    expect(await screen.findByText(/only part covered by this period/i)).toBeInTheDocument()
    // ⚠️ And the twin says *which week* W05 was, not just that it was partial. "W05" alone
    // answers "which week?" with nothing, which is the whole reason the hint exists -- and
    // the reader who cannot hover would otherwise be the only one left without it.
    // W05 runs 26 Jan to 1 Feb, so it names both months; W06 sits inside February and
    // names it once. Only as much date as the week actually needs.
    expect(await chartRows()).toEqual([
      ['26 Jan – 1 Feb 2026 (partial)', '1'],
      ['2–8 Feb 2026', '4'],
    ])
  })

  it('closes and reopens, and the closed state travels in the URL', async () => {
    renderApp('/reports')
    await chartRows()

    await userEvent.click(screen.getByRole('button', { name: /hide chart/i }))
    await waitFor(() => expect(currentLocation()).toContain('chart=off'))
    expect(screen.queryByRole('table', { name: /sessions over time/i })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /show chart/i }))
    // Back to the page's own default, so the param is dropped rather than spelled out.
    await waitFor(() => expect(currentLocation()).not.toContain('chart'))
  })

  it('does not count as a filter', async () => {
    renderApp('/reports?chart=off')

    await screen.findByRole('button', { name: /show chart/i })
    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument()
  })

  it('reports a failure rather than drawing an empty period', async () => {
    server.use(
      http.get('/api/reports/trends', () => HttpResponse.json({}, { status: 500 })),
    )

    renderApp('/reports')

    const alerts = await screen.findAllByRole('alert')
    expect(alerts.some((alert) => alert.textContent?.includes('Error 500'))).toBe(true)
  })

  it('reads an open-ended window against the newest session in the data', async () => {
    // ⚠️ The same regression as the instructor workload chart. A preset sets only a start,
    // and without standing in the resolved end a one-month window asked for monthly buckets
    // and drew a single bar.
    const seen = recordInterval()

    renderApp('/reports?date_from=2026-02-20')

    // The fixtures' newest session is 2026-03-14, so this is a three-week window.
    await waitFor(() => expect(seen).toContain('day'))
    expect(seen).not.toContain('month')
  })
})
