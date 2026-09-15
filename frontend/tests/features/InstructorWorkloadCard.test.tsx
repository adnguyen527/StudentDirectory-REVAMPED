import { HttpResponse, http } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderApp } from '../support/renderApp'
import { DANA, DANA_DETAIL } from '../support/sampleData'
import { server } from '../support/server'

const PROFILE = `/instructors/${encodeURIComponent(DANA)}`

/** The workload chart's twin, as [month, value] pairs. */
async function chartRows(name: RegExp): Promise<[string, string][]> {
  const table = await screen.findByRole('table', { name })
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map(
      (row) => within(row).getAllByRole('cell').map((cell) => cell.textContent ?? ''),
    ) as [string, string][]
}

function bucket(key: string, sessions: number, students: number, pages: number) {
  return {
    key,
    start: { $date: `${key}-01T00:00:00Z` },
    end: { $date: `${key}-28T00:00:00Z` },
    partial: false,
    sessions,
    students,
    pages_completed: pages,
  }
}

/** Counts requests so a client-side toggle can be told from a refetch. */
function countingTrends() {
  const calls: string[] = []
  server.use(
    http.get('/api/instructors/trends', ({ request }) => {
      calls.push(new URL(request.url).search)
      return HttpResponse.json({
        interval: 'month',
        range: { start: { $date: '2026-02-01T00:00:00Z' }, end: { $date: '2026-03-31T00:00:00Z' } },
        instructors: [DANA],
        buckets: [bucket('2026-02', 4, 3, 20), bucket('2026-03', 6, 2, 31)],
      })
    }),
  )
  return calls
}

describe('instructor workload chart', () => {
  it('opens on sessions', async () => {
    countingTrends()
    renderApp(PROFILE)

    expect(await chartRows(/sessions by/i)).toEqual([
      ['February 2026', '4'],
      ['March 2026', '6'],
    ])
  })

  it('switches measure without asking the server again', async () => {
    // ⚠️ One response carries all three measures, so the toggle is a projection. Refetching
    // would reload identical data and flash the skeleton over a chart already on screen.
    const calls = countingTrends()
    renderApp(PROFILE)
    await chartRows(/sessions by/i)
    expect(calls).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: 'Pages' }))

    expect(await chartRows(/pages by/i)).toEqual([
      ['February 2026', '20'],
      ['March 2026', '31'],
    ])
    expect(calls).toHaveLength(1)
  })

  it('narrows to this instructor', async () => {
    const calls = countingTrends()
    renderApp(PROFILE)
    await chartRows(/sessions by/i)

    // Decoded rather than compared as a string: URLSearchParams spells a space as '+',
    // not '%20', and the assertion is about the name reaching the route, not its encoding.
    expect(new URLSearchParams(calls[0]).getAll('instructor')).toEqual([DANA])
  })

  it('warns that co-taught pages cannot be added across instructors', async () => {
    // ⚠️ The reason the Pages option needs a footnote at all: pages are copied to every
    // instructor on a session, not split between them. Program-wide that arithmetic gives
    // 168,623 against the 153,360 actually recorded.
    countingTrends()
    renderApp(PROFILE)
    await chartRows(/sessions by/i)

    await userEvent.click(screen.getByRole('button', { name: 'Pages' }))

    expect(await screen.findByText(/51 pages in sessions they ran/i)).toBeInTheDocument()
    expect(
      await screen.findByText(/cannot be added across people/i),
    ).toBeInTheDocument()
  })

  it('never totals the distinct student count', async () => {
    countingTrends()
    renderApp(PROFILE)
    await chartRows(/sessions by/i)

    await userEvent.click(screen.getByRole('button', { name: 'Students' }))

    // 3 + 2 is not 5 students taught -- someone taught in both months is in both figures.
    expect(await screen.findByText(/at most 3 in one/i)).toBeInTheDocument()
    expect(screen.queryByText(/5 students/i)).not.toBeInTheDocument()
  })

  it('marks which measure is showing', async () => {
    countingTrends()
    renderApp(PROFILE)
    await chartRows(/sessions by/i)

    expect(screen.getByRole('button', { name: 'Sessions' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Pages' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('blames the window, not the instructor, when a period is empty', async () => {
    // The card opens on a window, so "no sessions" here means none *in these three months*
    // -- saying the instructor has none at all would be a different and probably wrong claim.
    server.use(
      http.get('/api/instructors/trends', () =>
        HttpResponse.json({ interval: 'week', range: null, buckets: [] }),
      ),
    )
    renderApp(PROFILE)

    expect(await screen.findByText(/no sessions in this period/i)).toBeInTheDocument()
  })

  it('says the instructor has none at all when there is no window to blame', async () => {
    // No last session means no anchor, so nothing seeds the window and the card really is
    // showing all of time. Both sentences are reachable; neither is a guess.
    server.use(
      http.get(`/api/instructors/${encodeURIComponent(DANA)}`, () =>
        HttpResponse.json({
          instructor: { ...DANA_DETAIL, last_session_date: null, days_taught: [] },
        }),
      ),
      http.get('/api/instructors/trends', () =>
        HttpResponse.json({ interval: 'month', range: null, buckets: [] }),
      ),
    )
    renderApp(PROFILE)

    expect(
      await screen.findByText(/no sessions recorded for this instructor/i),
    ).toBeInTheDocument()
  })

  it('opens on the three months ending at this instructor\u2019s last session', async () => {
    // ⚠️ Anchored on the instructor, not on today and not on the dataset. The data ends well
    // before the calendar does, so a window measured from now opens every card empty; and an
    // instructor who stopped teaching in March would open on an empty summer if the window
    // came from the dataset's newest session instead of their own.
    const calls = countingTrends()
    renderApp(PROFILE)
    await chartRows(/sessions by/i)

    const asked = new URLSearchParams(calls[0])
    // Dana last taught 2026-03-14.
    expect(asked.get('date_from')).toBe('2025-12-14')
    expect(asked.get('date_to')).toBe('2026-03-14')
  })

  it('asks for weekly buckets over three months, so the axis stays readable', async () => {
    // 90 days of daily bars is a texture rather than a chart; the width follows the window.
    const calls = countingTrends()
    renderApp(PROFILE)
    await chartRows(/sessions by/i)

    expect(new URLSearchParams(calls[0]).get('interval')).toBe('week')
  })

  it('refetches when the window changes, because only the route can answer it', async () => {
    // The mirror of the metric toggle below: a measure is a projection of data already held,
    // a period is a different question.
    const calls = countingTrends()
    renderApp(PROFILE)
    await chartRows(/sessions by/i)
    expect(calls).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: /session date/i }))
    await userEvent.click(await screen.findByRole('button', { name: /clear/i }))

    await waitFor(() => expect(calls).toHaveLength(2))
    // Cleared to any time, so no bounds are sent and the route falls back to its own default.
    expect(new URLSearchParams(calls[1]).get('date_from')).toBeNull()
  })

  it('reports a failure rather than an empty chart', async () => {
    server.use(
      http.get('/api/instructors/trends', () => HttpResponse.json({}, { status: 500 })),
    )
    renderApp(PROFILE)

    await waitFor(async () => {
      const alerts = await screen.findAllByRole('alert')
      expect(alerts.some((alert) => alert.textContent?.includes('Error 500'))).toBe(true)
    })
  })

  it('reads an open-ended window against this instructor\u2019s last session', async () => {
    // ⚠️ The regression. The date filter's presets set only a start, and a missing end used
    // to read as "window of unknown width" -- so "Since 18 Aug", a single month, asked for
    // monthly buckets and drew itself as one bar. The route resolves that end to the newest
    // session, and this card knows the date, so it stands it in.
    const calls = countingTrends()
    renderApp(PROFILE)
    await chartRows(/sessions by/i)

    await userEvent.click(screen.getByRole('button', { name: /session date/i }))
    await userEvent.click(await screen.findByRole('button', { name: /last 30 days/i }))

    await waitFor(() => expect(calls.length).toBeGreaterThan(1))
    const latest = new URLSearchParams(calls[calls.length - 1])
    expect(latest.get('date_to')).toBeNull()
    // A month of daily bars, not one monthly bar.
    expect(latest.get('interval')).toBe('day')
  })
})
