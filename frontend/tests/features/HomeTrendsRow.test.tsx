import { HttpResponse, http } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderApp } from '../support/renderApp'
import { server } from '../support/server'

/** One trend chart's twin, as [month, value] pairs. */
async function chartRows(name: RegExp): Promise<[string, string][]> {
  const table = await screen.findByRole('table', { name })
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map(
      (row) => within(row).getAllByRole('cell').map((cell) => cell.textContent ?? ''),
    ) as [string, string][]
}

/** A month of every measure, so each chart can be told apart by its numbers. */
function month(key: string, sessions: number, students: number, pages: number, unfinalized: number) {
  return {
    key,
    start: { $date: `${key}-01T00:00:00Z` },
    end: { $date: `${key}-28T00:00:00Z` },
    partial: false,
    sessions,
    students,
    pages_completed: pages,
    unfinalized,
  }
}

function withTrends() {
  server.use(
    http.get('/api/home/trends', () =>
      HttpResponse.json({
        interval: 'month',
        range: { start: { $date: '2026-01-01T00:00:00Z' }, end: { $date: '2026-02-28T00:00:00Z' } },
        centers: [],
        buckets: [month('2026-01', 1761, 446, 8456, 46), month('2026-02', 1500, 400, 7000, 30)],
      }),
    ),
  )
}

describe('home activity trends', () => {
  it('draws each measure on its own chart', async () => {
    // ⚠️ The assertion this row's whole shape exists for. Pages run ~180x the unfinalized
    // count, so a shared y-axis would flatten unfinalized into the baseline. Four charts,
    // four axes -- and each has to carry its own numbers.
    withTrends()
    renderApp('/')

    // The twin names the month in full; the axis keeps the three-letter form.
    expect(await chartRows(/sessions by month/i)).toEqual([
      ['January 2026', '1,761'],
      ['February 2026', '1,500'],
    ])
    expect(await chartRows(/pages completed by month/i)).toEqual([
      ['January 2026', '8,456'],
      ['February 2026', '7,000'],
    ])
    expect(await chartRows(/unfinalized reports by month/i)).toEqual([
      ['January 2026', '46'],
      ['February 2026', '30'],
    ])
  })

  it('fetches once for all four charts', async () => {
    // The route returns every measure per bucket, so four requests would be four scans of
    // the same reports.
    let calls = 0
    server.use(
      http.get('/api/home/trends', () => {
        calls += 1
        return HttpResponse.json({
          interval: 'month',
          range: null,
          buckets: [month('2026-01', 1, 1, 1, 1)],
        })
      }),
    )

    renderApp('/')
    await chartRows(/sessions by month/i)
    await waitFor(() => expect(calls).toBe(1))
  })

  it('never totals the distinct student count', async () => {
    // ⚠️ 446 + 400 is not 846 students -- someone attending in both months is in both
    // figures. The card reports the busiest month instead, and says why.
    withTrends()
    renderApp('/')

    expect(await screen.findByText(/at most 446 in a month/i)).toBeInTheDocument()
    expect(await screen.findByText(/counts in both, so these do not add up/i)).toBeInTheDocument()
    expect(screen.queryByText(/846/)).not.toBeInTheDocument()
  })

  it('totals the measures that do add up', async () => {
    withTrends()
    renderApp('/')

    expect(await screen.findByText(/3,261 sessions over 2 months/i)).toBeInTheDocument()
    expect(await screen.findByText(/15,456 pages over 2 months/i)).toBeInTheDocument()
  })

  it('reports no finalized count beside the unfinalized one', async () => {
    // It is sessions minus unfinalized, and two figures that must agree can disagree.
    withTrends()
    renderApp('/')

    await chartRows(/unfinalized reports by month/i)
    // Anchored: an unanchored /finalized/ matches "Unfinalized" and would always pass.
    expect(
      screen.queryByRole('table', { name: /^finalized reports by month$/i }),
    ).not.toBeInTheDocument()
  })

  it('stays out of the way when the trends cannot be loaded', async () => {
    // The tile row above already carries the page's error; a second copy of the same
    // failure says nothing new and pushes the student preview off the screen.
    server.use(http.get('/api/home/trends', () => HttpResponse.json({}, { status: 500 })))
    renderApp('/')

    await screen.findByRole('row', { name: /Anthony Nguyen/ })
    expect(screen.queryByRole('table', { name: /sessions by month/i })).not.toBeInTheDocument()
  })

  it('draws nothing at all when there is no data yet', async () => {
    server.use(
      http.get('/api/home/trends', () =>
        HttpResponse.json({ interval: 'month', range: null, buckets: [] }),
      ),
    )
    renderApp('/')

    await screen.findByRole('row', { name: /Anthony Nguyen/ })
    expect(screen.queryByRole('table', { name: /sessions by month/i })).not.toBeInTheDocument()
  })
})
