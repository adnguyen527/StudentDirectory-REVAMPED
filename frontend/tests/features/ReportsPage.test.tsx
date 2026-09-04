import { HttpResponse, http } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { currentLocation, renderApp } from '../support/renderApp'
import { ANTHONY_KEY, BARE_REPORT, REPORTS, RICH_REPORT } from '../support/sampleData'
import { server } from '../support/server'

/** A page's worth of reports, for the cases four fixtures cannot reach. */
function manyReports(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    ...REPORTS[0],
    _id: { $oid: String(i).padStart(24, '0') },
    student_name: `Student ${String(i).padStart(3, '0')}`,
    student_key: `key-${i}`,
  }))
}

function tableRows() {
  return within(screen.getByRole('table')).getAllByRole('row').slice(1)
}

/** The Date column of each row, in the order served -- which is what a sort changes. */
function dateColumn() {
  return tableRows()
    .map((row) => within(row).queryAllByRole('cell')[0]?.textContent)
    .filter((text) => text !== undefined)
}

/** The Student column, which is the other order this list can be put in. */
function studentColumn() {
  return tableRows()
    .map((row) => within(row).queryAllByRole('cell')[2]?.textContent)
    .filter((text) => text !== undefined)
}

describe('reports page', () => {
  it('shows a row per session with the figures a session is read for', async () => {
    renderApp('/reports')

    const rows = await screen.findAllByRole('row', { name: /Anthony Nguyen/ })
    const finalized = rows[0]
    // The date renders as a date, in UTC -- not "[object Object]" and not a day early.
    expect(within(finalized).getByText('Mar 14, 2026')).toBeInTheDocument()
    expect(within(finalized).getByText(/5:53 PM/)).toBeInTheDocument()
    expect(within(finalized).getByText('Westside')).toBeInTheDocument()
    // Pages completed against the goal set for that session.
    expect(within(finalized).getByText(/^7$/)).toBeInTheDocument()
    expect(within(finalized).getByText(/\/ 9/)).toBeInTheDocument()
    expect(within(finalized).getByText('88')).toBeInTheDocument()
  })

  it('marks a report nobody finalized, which is a different thing from an absence', async () => {
    // The student still attended; the instructor never completed the report.
    renderApp('/reports')

    await screen.findAllByRole('row', { name: /Anthony Nguyen/ })
    expect(screen.getAllByText('Unfinalized')).toHaveLength(2)
  })

  it('rests newest first, and says so under the title', async () => {
    renderApp('/reports')

    expect(await screen.findByText(/4 in total, newest first\./)).toBeInTheDocument()
    await waitFor(() =>
      expect(dateColumn()).toEqual(['Mar 14, 2026', 'Mar 14, 2026', 'Mar 10, 2026', 'Jan 5, 2026']),
    )
  })

  it('takes its filter from the URL, so a search result is linkable', async () => {
    renderApp('/reports?query=Chloe')

    await waitFor(() => expect(tableRows()).toHaveLength(2))
    expect(screen.getByText(/2 matching/)).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: /search reports by student name/i })).toHaveValue(
      'Chloe',
    )
  })

  it('searches the student rather than the instructor', async () => {
    // The instructor is a column you read; the student is what you arrive looking for.
    const { user } = renderApp('/reports')
    await screen.findAllByRole('row', { name: /Anthony Nguyen/ })

    await user.type(
      screen.getByRole('searchbox', { name: /search reports by student name/i }),
      'Marcus',
    )

    await waitFor(() => expect(currentLocation()).toBe('/reports?query=Marcus'))
    expect(await screen.findByText(/No reports match/)).toBeInTheDocument()
  })

  it('filters by center from the card header, alongside the search rather than instead', async () => {
    // Chloe is the only Eastside student, and she is not a Nguyen, so both at once find
    // nobody -- the two narrow together.
    const { user } = renderApp('/reports?query=Nguyen')
    await screen.findAllByRole('row', { name: /Anthony Nguyen/ })

    await user.click(screen.getByRole('button', { name: /all centers/i }))
    await user.click(await screen.findByRole('checkbox', { name: 'Eastside' }))

    await waitFor(() => expect(currentLocation()).toBe('/reports?query=Nguyen&center=Eastside'))
    expect(await screen.findByText(/No reports match/)).toBeInTheDocument()
  })

  it('takes the center filter from the URL, so a filtered list is linkable', async () => {
    renderApp('/reports?center=Eastside')

    await waitFor(() => expect(tableRows()).toHaveLength(2))
    expect(screen.getByRole('button', { name: /Eastside/ })).toBeInTheDocument()
  })

  it('filters by a date window, both ends inclusive', async () => {
    // Two sessions on 3/14, one on 3/10, one on 1/5.
    renderApp('/reports?date_from=2026-03-14')

    await waitFor(() => expect(dateColumn()).toEqual(['Mar 14, 2026', 'Mar 14, 2026']))
    expect(
      screen.getByRole('button', { name: /filter by session date: since mar 14, 2026/i }),
    ).toBeInTheDocument()
  })

  it('sets the date window from a labelled pill, not a header glyph', async () => {
    // The filters live beside the search box here rather than in the column headers: a
    // session list is entered with a period already in mind.
    const { user } = renderApp('/reports')
    await screen.findAllByRole('row', { name: /Anthony Nguyen/ })

    await user.click(screen.getByRole('button', { name: /filter by session date: any time/i }))
    // The fixture's newest session is 2026-03-14, so 30 days back is 2026-02-12 -- the
    // preset counts from the data, not from today.
    const preset = await screen.findByRole('button', { name: /last 30 days/i })
    expect(preset).toHaveTextContent('Feb 12, 2026')

    await user.click(preset)
    await waitFor(() => expect(currentLocation()).toBe('/reports?date_from=2026-02-12'))
    await waitFor(() => expect(tableRows()).toHaveLength(3))
  })

  it('sorts by date from the header, newest first', async () => {
    const { user } = renderApp('/reports')
    await screen.findAllByRole('row', { name: /Anthony Nguyen/ })

    await user.click(screen.getByRole('button', { name: 'Date' }))

    await waitFor(() => expect(currentLocation()).toBe('/reports?sort=date&direction=desc'))
    expect(screen.getByRole('columnheader', { name: /date/i })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
  })

  it('reverses on a second click and turns off on a third', async () => {
    const { user } = renderApp('/reports')
    await screen.findByRole('button', { name: 'Date' })
    // Re-queried before every click: the table is replaced while the next request is in
    // flight, so a header held across a click is a detached node that swallows it.
    const header = () => screen.getByRole('button', { name: 'Date' })

    await user.click(header())
    await waitFor(() => expect(currentLocation()).toBe('/reports?sort=date&direction=desc'))

    await user.click(header())
    await waitFor(() => expect(currentLocation()).toBe('/reports?sort=date&direction=asc'))
    await waitFor(() =>
      expect(dateColumn()).toEqual(['Jan 5, 2026', 'Mar 10, 2026', 'Mar 14, 2026', 'Mar 14, 2026']),
    )

    await user.click(header())
    await waitFor(() => expect(currentLocation()).toBe('/reports'))
  })

  it('breaks a tie on the date the same way whichever way the column runs', async () => {
    // The property this route exists on: two sessions share 3/14, and skip/limit over a
    // partial order repeats a row on one page and drops it from the next. The tie-break is
    // ascending on _id in both directions, so the pair holds the same order either way.
    renderApp('/reports?sort=date&direction=desc')

    await waitFor(() =>
      expect(studentColumn().slice(0, 2)).toEqual(['Anthony Nguyen', 'Chloe Tan']),
    )
  })

  it('opens the student column A-Z, not newest-first', async () => {
    const { user } = renderApp('/reports')
    await screen.findAllByRole('row', { name: /Anthony Nguyen/ })

    await user.click(screen.getByRole('button', { name: 'Student' }))

    await waitFor(() => expect(currentLocation()).toBe('/reports?sort=student&direction=asc'))
    await waitFor(() =>
      expect(studentColumn()).toEqual([
        'Anthony Nguyen',
        'Anthony Nguyen',
        'Chloe Tan',
        'Chloe Tan',
      ]),
    )
  })

  it('clears every filter at once and keeps the order', async () => {
    const { user } = renderApp('/reports?query=Chloe&center=Eastside&sort=date&direction=asc')
    await waitFor(() => expect(tableRows()).toHaveLength(2))

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))

    await waitFor(() => expect(currentLocation()).toBe('/reports?sort=date&direction=asc'))
  })

  it('counts a date window as a filter, which is the one with no box to empty', async () => {
    renderApp('/reports?date_from=2026-03-14')

    await waitFor(() => expect(tableRows()).toHaveLength(2))
    expect(screen.getByRole('button', { name: 'Clear filter' })).toBeInTheDocument()
  })

  it('offers nothing to clear on an unfiltered list, paged or ordered', async () => {
    renderApp('/reports?offset=50&sort=date&direction=asc')

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /clear filter/i })).not.toBeInTheDocument(),
    )
  })

  it('expands a row to the session it describes', async () => {
    const { user } = renderApp('/reports')
    const rows = await screen.findAllByRole('row', { name: /Anthony Nguyen/ })

    await user.click(rows[0])

    expect(await screen.findByText('Session summary')).toBeInTheDocument()
    // The exports encode emoji as HTML character references; the panel decodes them.
    expect(
      screen.getByText(/Great progress on the distributive property today/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Distributive Property/)).toBeInTheDocument()
  })

  it('never shows staff notes about a student, which this route does not send', async () => {
    // Reading one child's notes on their profile and paging through 3,594 of them are
    // different acts -- models/dwp_report.py, LIST_PROJECTION. The panel has no label for
    // them at all, so no fixture and no later field can leak one in.
    const { user } = renderApp('/reports')
    const rows = await screen.findAllByRole('row', { name: /Anthony Nguyen/ })

    await user.click(rows[0])

    await screen.findByText('Session summary')
    expect(screen.queryByText('Student notes')).not.toBeInTheDocument()
    expect(screen.queryByText(/Prefers worked examples first/)).not.toBeInTheDocument()
  })

  it('opens a report from its own button', async () => {
    const { user } = renderApp('/reports')
    const rows = await screen.findAllByRole('row', { name: /Anthony Nguyen/ })

    await user.click(within(rows[0]).getByRole('link', { name: /open the mar 14, 2026 report/i }))

    await waitFor(() => expect(currentLocation()).toBe(`/reports/${RICH_REPORT._id.$oid}`))
  })

  it('offers that button on every row, including one with nothing to expand', async () => {
    // ⚠️ 2,063 reports (7%) have no topics, no summary and no assessment, so their row does
    // not respond to a click at all. The button is what makes them reachable, which is why
    // it is unconditional rather than drawn alongside the expander.
    renderApp('/reports')

    await waitFor(() => expect(tableRows()).toHaveLength(4))
    expect(screen.getAllByRole('link', { name: /^open the/i })).toHaveLength(4)

    const bare = screen.getByRole('row', { name: /Jan 5, 2026/ })
    expect(bare).not.toHaveAttribute('aria-expanded')
    expect(within(bare).getByRole('link', { name: /open the jan 5, 2026 report/i })).toHaveAttribute(
      'href',
      `/reports/${BARE_REPORT._id.$oid}`,
    )
  })

  it('leaves the list for the report, rather than expanding in place', async () => {
    // The button and the expander answer different questions from the same row, so the
    // one that navigates has to actually navigate. (The click also carries
    // stopPropagation, without which it would set expander state on the outgoing page --
    // not observable from here, since the table unmounts either way.)
    const { user } = renderApp('/reports')
    const rows = await screen.findAllByRole('row', { name: /Anthony Nguyen/ })

    await user.click(within(rows[0]).getByRole('link', { name: /open the mar 14, 2026 report/i }))

    await waitFor(() => expect(currentLocation()).toBe(`/reports/${RICH_REPORT._id.$oid}`))
    expect(await screen.findByRole('heading', { name: 'Session details' })).toBeInTheDocument()
    expect(screen.queryByRole('searchbox', { name: /search reports/i })).not.toBeInTheDocument()
  })

  it('opens a student from their name in the list', async () => {
    const { user } = renderApp('/reports')
    const links = await screen.findAllByRole('link', { name: 'Anthony Nguyen' })

    await user.click(links[0])

    await waitFor(() => {
      expect(currentLocation()).toBe(`/students/${encodeURIComponent(ANTHONY_KEY)}`)
    })
  })

  it('pages through the URL, so Back steps between pages', async () => {
    server.use(
      http.get('/api/reports', ({ request }) => {
        const url = new URL(request.url)
        const limit = Number(url.searchParams.get('limit') ?? 50)
        const offset = Number(url.searchParams.get('offset') ?? 0)
        const all = manyReports(60)
        const rows = all.slice(offset, offset + limit)
        return HttpResponse.json({
          reports: rows,
          page: { limit, offset, total: all.length, returned: rows.length },
        })
      }),
    )
    const { user } = renderApp('/reports')

    expect(await screen.findByText('1–50 of 60')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => expect(currentLocation()).toBe('/reports?offset=50'))
    expect(await screen.findByText('51–60 of 60')).toBeInTheDocument()
    await waitFor(() => expect(tableRows()).toHaveLength(10))
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled()
  })

  it('says no match, which must not look like a failure', async () => {
    renderApp('/reports?query=nobody')

    expect(await screen.findByText(/No reports match/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says what went wrong when the request fails, and shows no table', async () => {
    // A 500 rendering as an empty list reads as "no sessions happened".
    server.use(
      http.get('/api/reports', () =>
        HttpResponse.json(
          { error: 'Server error', detail: 'Set API_KEY in .env -- see .env.example' },
          { status: 500 },
        ),
      ),
    )
    renderApp('/reports')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Error 500')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('reaches the list from the sidebar', async () => {
    const { user } = renderApp('/')

    await user.click(screen.getByRole('link', { name: 'Reports' }))

    await waitFor(() => expect(currentLocation()).toBe('/reports'))
    expect(await screen.findByRole('heading', { name: 'Reports' })).toBeInTheDocument()
  })
})
