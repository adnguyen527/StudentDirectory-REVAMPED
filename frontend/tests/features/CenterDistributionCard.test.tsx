import { HttpResponse, http } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { currentLocation, renderApp } from '../support/renderApp'
import { server } from '../support/server'

/**
 * The centre distribution chart, above the students and instructors lists.
 *
 * ⚠️ Every assertion reads the chart's table twin, never its marks. jsdom performs no
 * layout -- widths are 0, there is no ResizeObserver -- so a bar's geometry is not
 * observable, and the marks are `aria-hidden` so a role query cannot reach them by
 * accident. The twin is the chart as far as this file, and a screen reader, are concerned.
 */

/** The chart's twin as [centre, count] pairs, in the order the bars are drawn. */
async function chartRows(name: RegExp): Promise<[string, string][]> {
  const table = await screen.findByRole('table', { name })
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map(
      (row) => within(row).getAllByRole('cell').map((cell) => cell.textContent ?? ''),
    ) as [string, string][]
}

async function openChart() {
  await userEvent.click(await screen.findByRole('button', { name: /show centre chart/i }))
}

describe('centre distribution chart', () => {
  it('is collapsed on arrival and costs no request until it is opened', async () => {
    let calls = 0
    server.use(
      http.get('/api/students/distribution', () => {
        calls += 1
        return HttpResponse.json({
          centers: [], total: 0, counted: 0, no_center: 0, distribution: [],
        })
      }),
    )

    renderApp('/students')
    // Wait for the page itself, so a pending chart request would have landed by now.
    await screen.findByRole('row', { name: /Anthony Nguyen/ })

    expect(screen.queryByRole('table', { name: /students by centre/i })).not.toBeInTheDocument()
    // A distribution is a group-by over the whole filtered set, not the page on screen --
    // a chart nobody opened should not pay for it.
    expect(calls).toBe(0)
  })

  it('counts the students at each centre', async () => {
    renderApp('/students')
    await openChart()

    expect(await chartRows(/students by centre/i)).toEqual([
      ['Westside', '2'],
      ['Eastside', '1'],
    ])
  })

  it('counts an instructor at two centres under each, and says so', async () => {
    // ⚠️ The assertion this chart's note exists for. Dana works at both centres, so two
    // instructors produce three bars -- and a reader who cannot see why reads the
    // overshoot as a bug.
    renderApp('/instructors')
    await openChart()

    expect(await chartRows(/instructors by centre/i)).toEqual([
      ['Westside', '2'],
      ['Eastside', '1'],
    ])
    expect(
      await screen.findByText(/3 centre appearances across 2 instructors/i),
    ).toBeInTheDocument()
  })

  it('says only the plain total when nobody spans two centres', async () => {
    renderApp('/students')
    await openChart()

    expect(await screen.findByText(/^3 students\.$/i)).toBeInTheDocument()
    expect(screen.queryByText(/centre appearances/i)).not.toBeInTheDocument()
  })

  it('narrows with the list it sits above', async () => {
    renderApp('/students?center=Eastside')
    await openChart()

    // The bars answer the same question the table does, through the same filters.
    expect(await chartRows(/students by centre/i)).toEqual([['Eastside', '1']])
  })

  it('follows the search box', async () => {
    renderApp('/students?query=Nguyen')
    await openChart()

    expect(await chartRows(/students by centre/i)).toEqual([['Westside', '2']])
  })

  it('follows a column range filter', async () => {
    // Only Anthony has two sessions, and he is at Westside.
    renderApp('/students?sessions_min=2')
    await openChart()

    expect(await chartRows(/students by centre/i)).toEqual([['Westside', '1']])
  })

  it('does not refetch when the list is paged or re-sorted', async () => {
    // ⚠️ offset, sort and direction position the list without narrowing it, so they cannot
    // change these bars. Sending them would refetch an identical answer on every click.
    let calls = 0
    server.use(
      http.get('/api/students/distribution', () => {
        calls += 1
        return HttpResponse.json({
          centers: [],
          total: 3,
          counted: 3,
          no_center: 0,
          distribution: [{ center: 'Westside', count: 2 }],
        })
      }),
    )

    renderApp('/students?chart=on')
    await chartRows(/students by centre/i)
    expect(calls).toBe(1)

    // Scoped to the list: the page now holds two tables, so an unscoped query for a column
    // header is ambiguous -- the same trap StudentProfilePage.test.tsx documents.
    const list = screen.getByRole('table', { name: '' })
    await userEvent.click(within(list).getByRole('button', { name: /^sessions$/i }))
    await waitFor(() => expect(currentLocation()).toContain('sort=sessions'))

    expect(calls).toBe(1)
  })

  it('keeps the open chart in the URL, so the view can be sent to someone', async () => {
    renderApp('/students')
    await openChart()

    await waitFor(() => expect(currentLocation()).toContain('chart=on'))
    // And back to the default drops it again rather than spelling out a no-op.
    await userEvent.click(screen.getByRole('button', { name: /hide centre chart/i }))
    await waitFor(() => expect(currentLocation()).not.toContain('chart'))
  })

  it('does not count as a filter', async () => {
    // ⚠️ ClearFilters treats every param outside VIEW_PARAMS as a filter. A chart toggle
    // narrows nothing, so it must not raise the Clear button -- or clearing would close it.
    renderApp('/students?chart=on')
    await chartRows(/students by centre/i)

    expect(screen.queryByRole('button', { name: /clear/i })).not.toBeInTheDocument()
  })

  it('reports a failure rather than drawing an empty chart', async () => {
    // A 500 rendering as a chart with no bars reads as "nobody is at any centre".
    server.use(
      http.get('/api/students/distribution', () => HttpResponse.json({}, { status: 500 })),
    )

    renderApp('/students?chart=on')
    expect(await screen.findByRole('alert')).toHaveTextContent(/error 500/i)
  })

  it('says so when the filters match nobody', async () => {
    renderApp('/students?query=Nobody At All&chart=on')

    expect(await screen.findByText(/no students match these filters/i)).toBeInTheDocument()
  })
})
