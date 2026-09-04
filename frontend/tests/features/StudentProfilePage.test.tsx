import { HttpResponse, http } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { currentLocation, renderApp } from '../support/renderApp'
import {
  ANTHONY_ATTENDANCE,
  ANTHONY_DETAIL,
  ANTHONY_KEY,
  ANTHONY_REPORTS,
  DANA,
  MARCUS,
  day,
} from '../support/sampleData'
import { server } from '../support/server'

const PROFILE = `/students/${encodeURIComponent(ANTHONY_KEY)}`

/** The instructor names in the order the card shows them. */
function instructorNames() {
  const table = within(
    screen.getByRole('heading', { name: /^Instructors$/ }).closest('.card') as HTMLElement,
  ).getByRole('table')
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent)
}


/**
 * The card with this title.
 *
 * The profile stacks four tables -- attendance months, topics, instructors, sessions --
 * so an unscoped getByRole('table') is ambiguous, and a date can appear in two of them.
 * Scoping says which card a test means, the way a reader would.
 */
async function card(title: RegExp | string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: title })
  return heading.closest('.card') as HTMLElement
}

/**
 * The stat tile with this label.
 *
 * Matched on `.stat-label` because the words also appear as column headers -- "Sessions"
 * heads a column in both the topics and the instructors tables.
 */
async function tile(label: string): Promise<HTMLElement> {
  const el = await screen.findByText(label, { selector: '.stat-label' })
  return el.closest('.stat-tile') as HTMLElement
}

/** The attendance card's headline figures as [label, value], in the order shown. */
function headlineFigures(panel: HTMLElement): [string, string][] {
  return [...panel.querySelectorAll('.attendance-totals > div')].map((cell) => [
    cell.querySelector('.muted')?.textContent ?? '',
    cell.querySelector('.attendance-figure')?.textContent ?? '',
  ])
}

/**
 * The profile carries the app's subtlest decisions, so these pin the reasoning rather
 * than the pixels: which topic counter is shown, what "on plan" means, and where the
 * attendance period starts.
 */
describe('student profile', () => {
  it('shows topics finished, not the completed-only count', async () => {
    // The source writes one status per session, so a mastered topic is almost never also
    // written Completed. Reading ..._completed here understates the work about twentyfold.
    renderApp(PROFILE)

    const finished = await tile('Topics finished')
    expect(within(finished).getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('Topics completed')).not.toBeInTheDocument()
  })

  it('counts all-time months on the sessions tile, beside the last session', async () => {
    // Both fixture reports fall in March 2026, so this also pins the singular.
    renderApp(PROFILE)

    const sessions = await tile('Sessions')
    expect(within(sessions).getByText('2')).toBeInTheDocument()
    expect(within(sessions).getByText('1 month · last Mar 14, 2026')).toBeInTheDocument()
  })

  it('counts months on the tile from every session, not the panel period', async () => {
    // The tile is all-time; the panel is scoped to its date range. They are allowed to
    // disagree, so the tile must not be reading by_month.
    server.use(
      http.get('/api/students/:key', () =>
        HttpResponse.json({
          student: ANTHONY_DETAIL,
          stats: { total_dwp_reports: 4 },
          dwp_reports: [
            { ...ANTHONY_REPORTS[0], _id: { $oid: 'a'.repeat(24) }, date: day('2025-11-04') },
            { ...ANTHONY_REPORTS[0], _id: { $oid: 'b'.repeat(24) }, date: day('2025-11-19') },
            { ...ANTHONY_REPORTS[0], _id: { $oid: 'c'.repeat(24) }, date: day('2026-01-08') },
            { ...ANTHONY_REPORTS[0], _id: { $oid: 'd'.repeat(24) }, date: day('2026-03-02') },
          ],
        }),
      ),
    )
    renderApp(PROFILE)

    const sessions = await tile('Sessions')
    // Four sessions over three distinct months -- the two November ones count once.
    expect(within(sessions).getByText(/^3 months ·/)).toBeInTheDocument()

    // Meanwhile the panel still reports its own period, from the attendance response.
    const panel = await card(/Sessions in a period/)
    await within(panel).findByText('months attended')
    expect(headlineFigures(panel)).toContainEqual(['months attended', '2'])
  })

  it('counts a session on the 1st in its own month, not the one before', async () => {
    // Midnight UTC on 1 March reads as 28 February in any zone west of UTC.
    server.use(
      http.get('/api/students/:key', () =>
        HttpResponse.json({
          student: ANTHONY_DETAIL,
          stats: { total_dwp_reports: 1 },
          dwp_reports: [{ ...ANTHONY_REPORTS[0], date: day('2026-03-01') }],
        }),
      ),
    )
    renderApp(PROFILE)

    const sessions = await tile('Sessions')
    expect(within(sessions).getByText(/^1 month ·/)).toBeInTheDocument()
  })

  it('opens the topics card on what the student is working on now', async () => {
    // `state` reads the last assignment only, which is the honest answer to that question;
    // the all-time counters mean "ever" and are expected to disagree.
    renderApp(PROFILE)

    const chip = await screen.findByRole('button', { name: /On plan/ })
    expect(chip).toHaveClass('chip-active')

    const topics = within(await card(/^Topics$/))
    expect(topics.getByText('Combining Radicals')).toBeInTheDocument()
    // The finished and removed topics are filtered out, not merely sorted below.
    expect(topics.queryByText('Distributive Property')).not.toBeInTheDocument()
    expect(topics.queryByText('Long Division')).not.toBeInTheDocument()
  })

  it('flags a topic that came back onto the plan', async () => {
    const { user } = renderApp(PROFILE)

    await user.click(await screen.findByRole('button', { name: /Finished/ }))

    const row = within(await card(/^Topics$/)).getByRole('row', { name: /Distributive Property/ })
    // times_assigned 2 means one return -- a topic handed back, which is the thing worth
    // noticing in a history.
    expect(within(row).getByText(/reassigned ×1/)).toBeInTheDocument()
  })

  it('anchors the attendance period on the last session, not today', async () => {
    // The route refuses to default a period because "this month" silently returns nothing
    // whenever the data lags the calendar. Anchoring on today would open this panel empty
    // on every student; the fixture's last session is 2026-03-14.
    renderApp(PROFILE)

    expect(await screen.findByLabelText('Period start')).toHaveValue('2025-12-14')
    expect(screen.getByLabelText('Period end')).toHaveValue('2026-03-14')
  })

  it('reports sessions, days and months as three separate figures', async () => {
    // Three granularities of the same attendance, coarsest last. A day with two sessions
    // draws down two; a month with twelve sessions counts once. Showing fewer of these
    // invites the reader to take one for another.
    renderApp(PROFILE)

    const panel = await card(/Sessions in a period/)
    await within(panel).findByText('days attended')

    // Read each figure with its own label: the month breakdown below repeats these
    // numbers, and two of the three can legitimately be equal, so position or text alone
    // would not prove which is which.
    expect(headlineFigures(panel)).toEqual([
      ['sessions', '3'],
      ['days attended', '2'],
      ['months attended', '2'],
    ])
  })

  it('counts only the months attended, not the months the range covers', async () => {
    // The rule: a month counts if they turned up in it. by_month is built from visits, so
    // a missed month is absent rather than present as a zero -- here the range spans six
    // months and they attended in two.
    server.use(
      http.get('/api/students/:key/attendance', () =>
        HttpResponse.json({
          ...ANTHONY_ATTENDANCE,
          period: { start: '2025-10-01', end: '2026-03-31' },
          totals: { sessions: 9, days: 5 },
          by_month: [
            { month: '2025-11', sessions: 4, days: 2 },
            { month: '2026-03', sessions: 5, days: 3 },
          ],
        }),
      ),
    )
    renderApp(PROFILE)

    const panel = await card(/Sessions in a period/)
    await within(panel).findByText('months attended')

    expect(headlineFigures(panel)).toEqual([
      ['sessions', '9'],
      ['days attended', '5'],
      // Two, not six: December, January and February were skipped and do not count.
      ['months attended', '2'],
    ])
  })

  it('blocks an impossible period instead of collecting the API 400', async () => {
    const { user } = renderApp(PROFILE)

    const start = await screen.findByLabelText('Period start')
    await user.clear(start)
    await user.type(start, '2026-06-01')

    expect(await screen.findByText(/start date is after the end date/i)).toBeInTheDocument()
  })

  it('expands a session to its notes, with the emoji decoded', async () => {
    const { user } = renderApp(PROFILE)

    const history = within(await card(/Session history/))
    await user.click(await history.findByRole('row', { name: /Mar 14, 2026/ }))

    expect(await screen.findByText(/Great progress on the distributive property today 👍/))
      .toBeInTheDocument()
    // Staff commentary about a named child, labelled so it cannot be mistaken for
    // parent-facing copy.
    expect(screen.getByText(/Student notes/i)).toBeInTheDocument()
    expect(screen.getByText('Prefers worked examples first.')).toBeInTheDocument()
  })

  it('marks the open session row, and unmarks it on close', async () => {
    // Without this the only sign of which session is open is a panel below it, which is
    // easy to lose on a 25-row page. The unmarking half is the part that rots quietly.
    const { user } = renderApp(PROFILE)

    const history = within(await card(/Session history/))
    const row = await history.findByRole('row', { name: /Mar 14, 2026/ })
    expect(row).toHaveAttribute('aria-expanded', 'false')

    await user.click(row)
    await waitFor(() => expect(row).toHaveAttribute('aria-expanded', 'true'))
    expect(row).toHaveClass('row-open')

    await user.click(row)
    await waitFor(() => expect(row).toHaveAttribute('aria-expanded', 'false'))
    expect(row).not.toHaveClass('row-open')
  })

  it('never marks a row that has nothing to open', async () => {
    // The Mar 10 report has no notes, assessment or topics, so clicking it does nothing
    // -- and must not look like it did.
    const { user } = renderApp(PROFILE)

    const history = within(await card(/Session history/))
    const row = await history.findByRole('row', { name: /Mar 10, 2026/ })
    expect(row).not.toHaveAttribute('aria-expanded')

    await user.click(row)

    expect(row).not.toHaveClass('row-open')
  })

  it('renders the session wall clock the source recorded', async () => {
    renderApp(PROFILE)
    // 17:53Z stored naive; a local reading would say 12:53 PM.
    expect(await screen.findByText('5:53 PM – 6:53 PM')).toBeInTheDocument()
  })

  it('renders no empty labelled sections for a session with no notes', async () => {
    const { user } = renderApp(PROFILE)

    const history = within(await card(/Session history/))
    await user.click(await history.findByRole('row', { name: /Mar 10, 2026/ }))

    // That report has no notes, no assessment and no topics, so nothing should open.
    expect(screen.queryByText(/Session summary/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Assessment/i)).not.toBeInTheDocument()
  })

  it('marks a session whose report was never completed', async () => {
    renderApp(PROFILE)
    const history = within(await card(/Session history/))
    const row = await history.findByRole('row', { name: /Mar 10, 2026/ })
    expect(within(row).getByText('Unfinalized')).toBeInTheDocument()
  })

  it('averages pages over the sessions that recorded any', async () => {
    // Dana has 6 sessions but one was never finalized, so it carries no page count:
    // 60 pages over the 5 that do = 12.0. Dividing by all 6 would read 10.0, which is the
    // mistake this asserts against -- and it understates 23.7% of the rows shown.
    renderApp(PROFILE)

    const instructors = within(await card(/^Instructors$/))
    const dana = await instructors.findByRole('row', { name: new RegExp(DANA) })
    expect(within(dana).getByText('12.0')).toBeInTheDocument()
    expect(within(dana).queryByText('10.0')).not.toBeInTheDocument()
  })

  it('withholds the rate below five sessions rather than printing noise', async () => {
    // Marcus has one session. A single heavy day is not a pace, and the median
    // (student, instructor) pair in the real data is 2 sessions.
    renderApp(PROFILE)

    const instructors = within(await card(/^Instructors$/))
    const marcus = await instructors.findByRole('row', { name: new RegExp(MARCUS) })
    expect(within(marcus).getByText('—')).toBeInTheDocument()
  })

  it('says how the rate is worked out, since it is not pages over sessions', async () => {
    renderApp(PROFILE)

    const instructors = within(await card(/^Instructors$/))
    expect(
      await instructors.findByText(/averages over sessions with a recorded page count/),
    ).toBeInTheDocument()
  })

  it('pages the instructors card ten at a time', async () => {
    // The median student has 9 instructors and the widest 23, so 43% of profiles page.
    // The whole list arrives in the detail response, so paging it costs no request.
    const instructors = Array.from({ length: 12 }, (_, i) => ({
      name: `Instructor ${String(i).padStart(2, '0')}`,
      sessions: 12 - i,
      pages_completed: i,
    }))
    server.use(
      http.get('/api/students/:key', () =>
        HttpResponse.json({
          student: { ...ANTHONY_DETAIL, instructors },
          stats: { total_dwp_reports: ANTHONY_REPORTS.length },
          dwp_reports: ANTHONY_REPORTS,
        }),
      ),
    )
    const { user } = renderApp(PROFILE)

    const card_ = within(await card(/^Instructors$/))
    expect(await card_.findByText('1–10 of 12')).toBeInTheDocument()
    expect(card_.getByRole('button', { name: /previous/i })).toBeDisabled()

    await user.click(card_.getByRole('button', { name: /next/i }))

    expect(await card_.findByText('11–12 of 12')).toBeInTheDocument()
    expect(card_.getByRole('link', { name: 'Instructor 10' })).toBeInTheDocument()
    expect(card_.queryByRole('link', { name: 'Instructor 00' })).not.toBeInTheDocument()
    expect(card_.getByRole('button', { name: /next/i })).toBeDisabled()
  })

  it('sorts the instructors card from its headers', async () => {
    // Dana has 6 sessions with Anthony, Marcus 1.
    const { user } = renderApp(PROFILE)
    const instructors = within(await card(/^Instructors$/))
    await instructors.findByRole('row', { name: new RegExp(DANA) })

    await user.click(instructors.getByRole('button', { name: 'Sessions' }))
    await waitFor(() => expect(instructorNames()).toEqual([DANA, MARCUS]))

    await user.click(instructors.getByRole('button', { name: 'Sessions' }))
    await waitFor(() => expect(instructorNames()).toEqual([MARCUS, DANA]))

    // Third click returns the card to the order the response carried.
    await user.click(instructors.getByRole('button', { name: 'Sessions' }))
    await waitFor(() => expect(instructorNames()).toEqual([DANA, MARCUS]))
  })

  it('keeps the card sort out of the URL', async () => {
    // Three tables on this page, so one ?sort= between them would belong to whichever
    // was clicked last -- and the card pages in local state, so a linked URL would
    // restore an order but not the page it was on.
    const { user } = renderApp(PROFILE)
    const instructors = within(await card(/^Instructors$/))
    await instructors.findByRole('row', { name: new RegExp(DANA) })

    await user.click(instructors.getByRole('button', { name: 'Sessions' }))

    await waitFor(() => expect(instructorNames()).toEqual([DANA, MARCUS]))
    expect(currentLocation()).toBe(PROFILE)
  })

  it('sorts an instructor with no rate to the bottom, either way round', async () => {
    // Marcus has one session, so there is no pages-per-session figure for him. A dash is
    // not a zero, and an ascending sort must not lead with it.
    const { user } = renderApp(PROFILE)
    const instructors = within(await card(/^Instructors$/))
    await instructors.findByRole('row', { name: new RegExp(DANA) })

    await user.click(instructors.getByRole('button', { name: 'Pages / session' }))
    await waitFor(() => expect(instructorNames()).toEqual([DANA, MARCUS]))

    await user.click(instructors.getByRole('button', { name: 'Pages / session' }))
    await waitFor(() => expect(instructorNames()).toEqual([DANA, MARCUS]))
  })

  it('filters the instructors card to a range, and counts what is left', async () => {
    const { user } = renderApp(PROFILE)
    const instructors = within(await card(/^Instructors$/))
    await instructors.findByRole('row', { name: new RegExp(DANA) })

    await user.click(instructors.getByRole('button', { name: /filter by sessions/i }))
    await user.type(screen.getByRole('spinbutton', { name: /minimum sessions/i }), '5')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(instructorNames()).toEqual([DANA]))
    // The pager counts the filtered list, not the roster -- "1-10 of 2" over one row
    // would be a pager describing rows the table is not showing.
    expect(instructors.getByText('1–1 of 1')).toBeInTheDocument()
    expect(currentLocation()).toBe(PROFILE)
  })

  it('says that a rate range leaves out the instructors who have no rate', async () => {
    const { user } = renderApp(PROFILE)
    const instructors = within(await card(/^Instructors$/))
    await instructors.findByRole('row', { name: new RegExp(DANA) })

    await user.click(instructors.getByRole('button', { name: /filter by pages per session/i }))
    expect(await screen.findByText(/have no rate, so any range here leaves them out/i))
      .toBeInTheDocument()

    await user.type(screen.getByRole('spinbutton', { name: /minimum pages per session/i }), '1')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    // Marcus has no rate, so no range matches him -- including one he would pass on pages.
    await waitFor(() => expect(instructorNames()).toEqual([DANA]))
  })

  it('opens an instructor from the instructors card', async () => {
    // The reverse of the instructor profile's roster, which already links back here.
    const { user } = renderApp(PROFILE)

    const instructors = within(await card(/^Instructors$/))
    await user.click(instructors.getByRole('link', { name: 'Dana Reyes' }))

    await waitFor(() => expect(currentLocation()).toBe('/instructors/Dana%20Reyes'))
  })

  it('opens an instructor from a session row without expanding it', async () => {
    // The row toggles the notes expander, so the link has to stop the click from also
    // opening a panel on the page being navigated away from.
    const { user } = renderApp(PROFILE)

    const history = within(await card(/Session history/))
    const row = await history.findByRole('row', { name: /Mar 14, 2026/ })
    await user.click(within(row).getByRole('link', { name: 'Marcus Webb' }))

    await waitFor(() => expect(currentLocation()).toBe('/instructors/Marcus%20Webb'))
    expect(screen.queryByText(/Great progress/)).not.toBeInTheDocument()
  })

  it('links each instructor of a co-taught session separately', async () => {
    renderApp(PROFILE)

    const history = within(await card(/Session history/))
    const row = await history.findByRole('row', { name: /Mar 14, 2026/ })
    // Two names, two links -- not one link over "Dana Reyes, Marcus Webb".
    expect(within(row).getByRole('link', { name: 'Dana Reyes' })).toBeInTheDocument()
    expect(within(row).getByRole('link', { name: 'Marcus Webb' })).toBeInTheDocument()
  })

  it('offers a way back rather than an error box for an unknown student', async () => {
    const { user } = renderApp('/students/does-not-exist')

    expect(await screen.findByText(/Student not found/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /back to all students/i }))
    await waitFor(() => expect(currentLocation()).toBe('/students'))
  })
  it('reports a non-404 failure as an error, not as a missing student', async () => {
    server.use(
      http.get('/api/students/:key', () =>
        HttpResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      ),
    )
    renderApp(PROFILE)

    expect(await screen.findByRole('alert')).toHaveTextContent('Error 401')
    expect(screen.queryByText(/Student not found/)).not.toBeInTheDocument()
  })

  it('opens a session from the history, the same way the reports list does', async () => {
    // One report, one page, reached the same way from either table. ANTHONY_REPORTS[0] is
    // the 3/14 session, which is also RICH_REPORT on the reports list.
    const { user } = renderApp(PROFILE)

    const history = await card(/Session history/)
    await user.click(
      within(history).getByRole('link', { name: /open the mar 14, 2026 report/i }),
    )

    await waitFor(() =>
      expect(currentLocation()).toBe(`/reports/${ANTHONY_REPORTS[0]._id.$oid}`),
    )
    expect(await screen.findByRole('heading', { name: 'Session details' })).toBeInTheDocument()
  })

  it('offers that button on every session, expandable or not', async () => {
    // ANTHONY_REPORTS[1] has no topics, no summary and no assessment -- its row does not
    // respond to a click, so the button is the only way into it.
    renderApp(PROFILE)

    const history = await card(/Session history/)
    const rows = within(history).getAllByRole('row').slice(1)
    expect(within(history).getAllByRole('link', { name: /^open the/i })).toHaveLength(rows.length)

    const bare = within(history).getByRole('row', { name: /Mar 10, 2026/ })
    expect(bare).not.toHaveAttribute('aria-expanded')
    expect(within(bare).getByRole('link', { name: /open the mar 10, 2026 report/i })).toBeInTheDocument()
  })

  it('narrows the session history to a period', async () => {
    // Anthony's two sessions are 3/14 and 3/10. Every session is already in the detail
    // response, so this filters what is on screen and makes no request.
    const { user } = renderApp(PROFILE)

    const history = await card(/Session history/)
    expect(within(history).getAllByRole('row').slice(1)).toHaveLength(2)

    await user.click(
      within(history).getByRole('button', { name: /filter by session date: any time/i }),
    )
    await user.type(screen.getByLabelText(/earliest session date/i), '2026-03-12')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    // Both ends inclusive, as the API's own date bounds are.
    await waitFor(() => expect(within(history).getAllByRole('row').slice(1)).toHaveLength(1))
    expect(within(history).getByText('Mar 14, 2026')).toBeInTheDocument()
    expect(within(history).queryByText('Mar 10, 2026')).not.toBeInTheDocument()
    // The pager counts the period, not the student's whole history.
    expect(within(history).getByText('1–1 of 1')).toBeInTheDocument()
  })

  it('says a period is empty differently from a student with no sessions', async () => {
    // "No sessions recorded for this student" would be a false statement about a student
    // who simply did not attend in the window asked for.
    const { user } = renderApp(PROFILE)

    const history = await card(/Session history/)
    await user.click(
      within(history).getByRole('button', { name: /filter by session date: any time/i }),
    )
    await user.type(screen.getByLabelText(/earliest session date/i), '2026-06-01')
    await user.click(screen.getByRole('button', { name: 'Apply' }))

    expect(await within(history).findByText('No sessions in this period.')).toBeInTheDocument()
    expect(
      within(history).queryByText(/No sessions recorded for this student/),
    ).not.toBeInTheDocument()
  })

  it('pages the session history in the browser and collapses any open row', async () => {
    // The detail route returns every session in one response, so a page change here costs
    // no request. An expanded row must not survive the change -- you would return to it
    // having scrolled somewhere unrelated.
    const reports = Array.from({ length: 30 }, (_, i) => ({
      ...ANTHONY_REPORTS[0],
      _id: { $oid: String(i).padStart(24, '0') },
      date: { $date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z` },
    }))
    server.use(
      http.get('/api/students/:key', () =>
        HttpResponse.json({
          student: ANTHONY_DETAIL,
          stats: { total_dwp_reports: reports.length },
          dwp_reports: reports,
        }),
      ),
    )
    const { user } = renderApp(PROFILE)

    const history = await card(/Session history/)
    expect(await within(history).findByText('1–25 of 30')).toBeInTheDocument()

    // Open a row, then page: the notes must go with it.
    await user.click(within(history).getAllByRole('row')[1])
    expect(await screen.findByText(/Great progress/)).toBeInTheDocument()

    await user.click(within(history).getByRole('button', { name: /next/i }))
    expect(await within(history).findByText('26–30 of 30')).toBeInTheDocument()
    expect(screen.queryByText(/Great progress/)).not.toBeInTheDocument()
  })

  it('falls back to today when a student has never attended', async () => {
    // No last session to anchor on. The panel still has to open with a valid range rather
    // than crash or send an empty date.
    server.use(
      http.get('/api/students/:key', () =>
        HttpResponse.json({
          student: { ...ANTHONY_DETAIL, last_session_date: null },
          stats: { total_dwp_reports: 0 },
          dwp_reports: [],
        }),
      ),
    )
    renderApp(PROFILE)

    const end = await screen.findByLabelText('Period end')
    expect(end).toHaveValue(new Date().toISOString().slice(0, 10))
  })

  it('orders topics by when they were last worked, missing dates last', async () => {
    server.use(
      http.get('/api/students/:key', () =>
        HttpResponse.json({
          student: {
            ...ANTHONY_DETAIL,
            topics: [
              { ...ANTHONY_DETAIL.topics[1], id: 'PK-A', name: 'Older', last_seen: day('2026-01-01') },
              // A topic with no last_seen must not sort above a real date, nor throw.
              { ...ANTHONY_DETAIL.topics[1], id: 'PK-B', name: 'Undated', last_seen: null },
              { ...ANTHONY_DETAIL.topics[1], id: 'PK-C', name: 'Newer', last_seen: day('2026-03-01') },
            ],
          },
          stats: { total_dwp_reports: 0 },
          dwp_reports: [],
        }),
      ),
    )
    renderApp(PROFILE)

    const topics = await card(/^Topics$/)
    const names = within(topics)
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[0].textContent)
    expect(names).toEqual(['NewerPK-C', 'OlderPK-A', 'UndatedPK-B'])
  })

  it('pages the topic list ten at a time', async () => {
    // 47 topics is an ordinary student and 68 is the widest in the data, so the card had
    // been rendering the whole history in one column.
    const topics = Array.from({ length: 23 }, (_, i) => ({
      ...ANTHONY_DETAIL.topics[0],
      id: `PK-${String(i).padStart(4, '0')}`,
      name: `Topic ${String(i).padStart(3, '0')}`,
      state: 'on_plan' as const,
      last_seen: day(`2026-03-${String((i % 28) + 1).padStart(2, '0')}`),
    }))
    server.use(
      http.get('/api/students/:key', () =>
        HttpResponse.json({
          student: { ...ANTHONY_DETAIL, topics },
          stats: { total_dwp_reports: 0 },
          dwp_reports: [],
        }),
      ),
    )
    const { user } = renderApp(PROFILE)

    const card_ = await card(/^Topics$/)
    expect(await within(card_).findByText('1–10 of 23')).toBeInTheDocument()
    expect(within(card_).getAllByRole('row').slice(1)).toHaveLength(10)

    await user.click(within(card_).getByRole('button', { name: /next/i }))
    expect(await within(card_).findByText('11–20 of 23')).toBeInTheDocument()

    await user.click(within(card_).getByRole('button', { name: /next/i }))
    expect(await within(card_).findByText('21–23 of 23')).toBeInTheDocument()
    // Three real rows on the short last page, and nowhere further to go. The seven fillers
    // beside them are aria-hidden, so they are not rows as far as this query is concerned.
    expect(within(card_).getAllByRole('row').slice(1)).toHaveLength(3)
    expect(card_.querySelectorAll('tbody tr')).toHaveLength(10)
    expect(within(card_).getByRole('button', { name: /next/i })).toBeDisabled()
  })

  it('wraps the topic name so it can scroll, and keeps the full one reachable', async () => {
    // The name is clipped to one line, so the untruncated text has to survive somewhere:
    // in the title, and in the inner span the hover transform translates. Neither the
    // scrolling nor the clipping is assertable here -- jsdom does no layout -- but the
    // markup they both depend on is.
    renderApp(PROFILE)

    const row = within(await card(/^Topics$/)).getByRole('row', { name: /Combining Radicals/ })
    const name = row.querySelector('.topic-name') as HTMLElement
    expect(name).toHaveAttribute('title', 'Combining Radicals')
    expect(name.querySelector('span')?.textContent).toBe('Combining Radicals')
  })

  it('gives every row a tag line, whether or not it has a tag to put in it', async () => {
    // ⚠️ The fix for the uneven rows. A tag rendered only on the rows that had one made
    // those rows taller and the card jump between filters. The stand-in has to be present
    // but aria-hidden: it is spacing, not a claim that the topic was reassigned.
    const topics = [
      { ...ANTHONY_DETAIL.topics[0], id: 'PK-A', name: 'Came back', state: 'on_plan' as const, times_assigned: 2 },
      { ...ANTHONY_DETAIL.topics[0], id: 'PK-B', name: 'Never left', state: 'on_plan' as const, times_assigned: 1 },
    ]
    server.use(
      http.get('/api/students/:key', () =>
        HttpResponse.json({
          student: { ...ANTHONY_DETAIL, topics },
          stats: { total_dwp_reports: 0 },
          dwp_reports: [],
        }),
      ),
    )
    renderApp(PROFILE)

    const card_ = await card(/^Topics$/)
    const rowFor = (name: string) =>
      within(card_).getByRole('row', { name: new RegExp(name) })

    const flagged = rowFor('Came back').querySelector('.topic-flag') as HTMLElement
    expect(flagged).toHaveTextContent('reassigned ×1')
    expect(flagged).not.toHaveAttribute('aria-hidden')

    const held = rowFor('Never left').querySelector('.topic-flag') as HTMLElement
    expect(held).toBeInTheDocument()
    expect(held).toHaveAttribute('aria-hidden', 'true')
    expect(held).not.toHaveTextContent('reassigned')
  })

  it('pads a short page so the card does not change height with the filter', async () => {
    // ⚠️ The card shares a CardRow with the attendance panel, so a height that moved with
    // the chip moved the whole row. Four topics render four rows plus one blank.
    const topics = Array.from({ length: 4 }, (_, i) => ({
      ...ANTHONY_DETAIL.topics[0],
      id: `PK-${String(i).padStart(4, '0')}`,
      name: `Topic ${String(i).padStart(3, '0')}`,
      state: 'on_plan' as const,
    }))
    server.use(
      http.get('/api/students/:key', () =>
        HttpResponse.json({
          student: { ...ANTHONY_DETAIL, topics },
          stats: { total_dwp_reports: 0 },
          dwp_reports: [],
        }),
      ),
    )
    renderApp(PROFILE)

    const card_ = await card(/^Topics$/)
    // Four topics, four rows in the accessibility tree...
    await waitFor(() => expect(within(card_).getAllByRole('row').slice(1)).toHaveLength(4))
    // ...and ten in the DOM. The fillers are deliberately outside that tree, so the
    // physical count has to be read from the markup.
    expect(card_.querySelectorAll('tbody tr')).toHaveLength(10)

    // The pager counts the topics, never the padding.
    expect(within(card_).getByText('1–4 of 4')).toBeInTheDocument()
  })

  it('keeps the space for the pager controls when everything fits one page', async () => {
    // ⚠️ The last thing that moved this card. The pager drops its buttons when there is
    // nowhere to go -- right for most cards, wrong for one whose height is arranged not to
    // change. Reserved means present but hidden and unannounced, not rendered and dead.
    const topics = Array.from({ length: 3 }, (_, i) => ({
      ...ANTHONY_DETAIL.topics[0],
      id: `PK-${i}`,
      name: `Topic ${i}`,
      state: 'on_plan' as const,
    }))
    server.use(
      http.get('/api/students/:key', () =>
        HttpResponse.json({
          student: { ...ANTHONY_DETAIL, topics },
          stats: { total_dwp_reports: 0 },
          dwp_reports: [],
        }),
      ),
    )
    renderApp(PROFILE)

    const card_ = await card(/^Topics$/)
    await within(card_).findByText('1–3 of 3')

    // Out of the accessibility tree: nothing to tab to, nothing announced...
    expect(within(card_).queryByRole('button', { name: /next/i })).not.toBeInTheDocument()
    // ...but still in the layout, which is the entire point.
    const held = card_.querySelector('.pager-buttons-held')
    expect(held).toBeInTheDocument()
    expect(held).toHaveAttribute('aria-hidden', 'true')
  })

  it('pads nothing when the page is already full', async () => {
    const topics = Array.from({ length: 10 }, (_, i) => ({
      ...ANTHONY_DETAIL.topics[0],
      id: `PK-${String(i).padStart(4, '0')}`,
      name: `Topic ${String(i).padStart(3, '0')}`,
      state: 'on_plan' as const,
    }))
    server.use(
      http.get('/api/students/:key', () =>
        HttpResponse.json({
          student: { ...ANTHONY_DETAIL, topics },
          stats: { total_dwp_reports: 0 },
          dwp_reports: [],
        }),
      ),
    )
    renderApp(PROFILE)

    const card_ = await card(/^Topics$/)
    await waitFor(() => expect(within(card_).getAllByRole('row').slice(1)).toHaveLength(10))
    expect(card_.querySelectorAll('tbody tr')).toHaveLength(10)
  })

  it('names the browser tab for the student, once they have loaded', async () => {
    // The tab and the Back menu were identical on every route, which made the history
    // useless for finding the student you were reading a few minutes ago.
    renderApp(PROFILE)

    await screen.findByRole('heading', { name: 'Anthony Nguyen' })
    await waitFor(() => expect(document.title).toBe('Anthony Nguyen · Sigma'))
  })

  it('says so in the tab when there is no such student', async () => {
    server.use(
      http.get('/api/students/:key', () =>
        HttpResponse.json({ error: 'Student not found' }, { status: 404 }),
      ),
    )
    renderApp(PROFILE)

    await screen.findByText(/Student not found/)
    await waitFor(() => expect(document.title).toBe('Student not found · Sigma'))
  })

  it('searches the topic list from the box where the title used to be', async () => {
    const { user } = renderApp(PROFILE)

    const card_ = await card(/^Topics$/)
    // The heading is still there for a screen reader; what is gone is the visible title.
    expect(within(card_).getByRole('heading', { name: 'Topics' })).toHaveClass('sr-only')

    await user.click(await screen.findByRole('button', { name: /^All/ }))
    await user.type(screen.getByRole('searchbox', { name: /search topics/i }), 'radicals')

    await waitFor(() =>
      expect(within(card_).getAllByRole('row').slice(1)).toHaveLength(1),
    )
    expect(within(card_).getByText('Combining Radicals')).toBeInTheDocument()
    expect(within(card_).queryByText('Distributive Property')).not.toBeInTheDocument()
  })

  it('clears the topic search from a button in the field', async () => {
    const { user } = renderApp(PROFILE)

    const card_ = await card(/^Topics$/)
    await user.click(await screen.findByRole('button', { name: /^All/ }))
    const box = screen.getByRole('searchbox', { name: /search topics/i })
    await user.type(box, 'radicals')
    await waitFor(() => expect(within(card_).getAllByRole('row').slice(1)).toHaveLength(1))

    await user.click(within(card_).getByRole('button', { name: /clear search/i }))

    expect(box).toHaveValue('')
    // The whole list is back, and the chips are counting it again.
    await waitFor(() => expect(within(card_).getAllByRole('row').slice(1)).toHaveLength(3))
    // Focus stays in the field the button just removed itself from.
    expect(box).toHaveFocus()
  })

  it('matches the topic id as well as the name', async () => {
    // The row shows the id under the name and it is a real handle, so a box that showed
    // ids but could not search them would be incoherent -- as the topics list page says.
    const { user } = renderApp(PROFILE)

    const card_ = await card(/^Topics$/)
    await user.click(await screen.findByRole('button', { name: /^All/ }))
    await user.type(screen.getByRole('searchbox', { name: /search topics/i }), 'PK-1000')

    await waitFor(() => expect(within(card_).getAllByRole('row').slice(1)).toHaveLength(1))
    expect(within(card_).getByText('Distributive Property')).toBeInTheDocument()
  })

  it('counts the chips over the search, so a zero is an answer', async () => {
    // ⚠️ The search narrows first and the chips count what it left. Counting the whole
    // list instead would offer a chip reading 4 that lands on an empty table.
    const { user } = renderApp(PROFILE)

    await screen.findByRole('button', { name: /^All/ })
    await user.type(screen.getByRole('searchbox', { name: /search topics/i }), 'radicals')

    // Combining Radicals is the on-plan one, so every other state drops to zero. Read off
    // the chips' own text rather than their accessible names, which JSX joins without a
    // separator and would pin this test to that detail.
    const chipText = () =>
      [...document.querySelectorAll('.chip')].map((c) => c.textContent)
    await waitFor(() =>
      expect(chipText()).toEqual(['On plan1', 'Finished0', 'Removed0', 'All1']),
    )
  })

  it('returns to the first page when the filter changes', async () => {
    // ⚠️ Page 2 of "On plan" is not page 2 of "Finished" -- the same rule the list pages
    // apply when they drop ?offset= on a filter change. Without it you land mid-list, or
    // on a page that does not exist in the filter you just picked.
    const topics = Array.from({ length: 14 }, (_, i) => ({
      ...ANTHONY_DETAIL.topics[0],
      id: `PK-${String(i).padStart(4, '0')}`,
      name: `Topic ${String(i).padStart(3, '0')}`,
      state: 'on_plan' as const,
    }))
    server.use(
      http.get('/api/students/:key', () =>
        HttpResponse.json({
          student: { ...ANTHONY_DETAIL, topics: [...topics, ANTHONY_DETAIL.topics[0]] },
          stats: { total_dwp_reports: 0 },
          dwp_reports: [],
        }),
      ),
    )
    const { user } = renderApp(PROFILE)

    const card_ = await card(/^Topics$/)
    await user.click(await within(card_).findByRole('button', { name: /next/i }))
    expect(await within(card_).findByText('11–14 of 14')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^All/ }))

    expect(await within(card_).findByText('1–10 of 15')).toBeInTheDocument()
  })

  it('says so when a topic filter selects nothing', async () => {
    server.use(
      http.get('/api/students/:key', () =>
        HttpResponse.json({
          // Every topic finished, so the default "on plan" view is legitimately empty.
          student: {
            ...ANTHONY_DETAIL,
            topics: ANTHONY_DETAIL.topics.map((t) => ({ ...t, state: 'finished' as const })),
          },
          stats: { total_dwp_reports: ANTHONY_REPORTS.length },
          dwp_reports: ANTHONY_REPORTS,
        }),
      ),
    )
    renderApp(PROFILE)

    expect(await screen.findByText('No topics in this state.')).toBeInTheDocument()
  })

  it('shows a student with no sessions without breaking', async () => {
    server.use(
      http.get('/api/students/:key', () =>
        HttpResponse.json({
          student: { ...ANTHONY_DETAIL, topics: [], instructors: [] },
          stats: { total_dwp_reports: 0 },
          dwp_reports: [],
        }),
      ),
    )
    renderApp(PROFILE)

    expect(await screen.findByText('No sessions recorded for this student.')).toBeInTheDocument()
  })
})
