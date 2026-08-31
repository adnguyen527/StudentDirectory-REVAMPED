import { HttpResponse, http } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { currentLocation, renderApp } from '../support/renderApp'
import { ANTHONY_DETAIL, ANTHONY_KEY, ANTHONY_REPORTS, day } from '../support/sampleData'
import { server } from '../support/server'

const PROFILE = `/students/${encodeURIComponent(ANTHONY_KEY)}`

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
 * The profile carries the app's subtlest decisions, so these pin the reasoning rather
 * than the pixels: which topic counter is shown, what "on plan" means, and where the
 * attendance period starts.
 */
describe('student profile', () => {
  it('shows topics finished, not the completed-only count', async () => {
    // The source writes one status per session, so a mastered topic is almost never also
    // written Completed. Reading ..._completed here understates the work about twentyfold.
    renderApp(PROFILE)

    const tile = (await screen.findByText('Topics finished')).closest(
      '.stat-tile',
    ) as HTMLElement
    expect(within(tile).getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('Topics completed')).not.toBeInTheDocument()
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

  it('reports sessions and days as separate figures', async () => {
    // A day with two sessions draws down two. Showing one number invites the reader to
    // assume it is the other.
    renderApp(PROFILE)

    const panel = await card(/Sessions in a period/)
    await within(panel).findByText('days attended')

    // Read the two headline figures directly: the month breakdown below repeats these
    // numbers, so matching on text alone would not prove which is which.
    const figures = [...panel.querySelectorAll('.attendance-figure')].map((n) => n.textContent)
    expect(figures).toEqual(['3', '2'])
    expect(within(panel).getByText('sessions')).toBeInTheDocument()
    expect(within(panel).getByText('days attended')).toBeInTheDocument()
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
