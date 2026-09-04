import { HttpResponse, http } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { currentLocation, renderApp } from '../support/renderApp'
import { ANTHONY_KEY, DANA, DANA_DETAIL, day } from '../support/sampleData'
import { server } from '../support/server'

const PROFILE = `/instructors/${encodeURIComponent(DANA)}`

async function card(title: RegExp | string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: title })
  return heading.closest('.card') as HTMLElement
}

describe('instructor profile', () => {
  it('derives sessions per day rather than leaving two raw counts', async () => {
    // 4 sessions over 2 days. The ratio is what says whether a day was busy.
    renderApp(PROFILE)

    const tile = (await screen.findByText('Days taught')).closest('.stat-tile') as HTMLElement
    expect(within(tile).getByText('2')).toBeInTheDocument()
    expect(within(tile).getByText('2.0 sessions per day')).toBeInTheDocument()
  })

  it('shows unfinalized reports as a share as well as a count', async () => {
    // 1 of 4 means something different than 1 of 1,000.
    renderApp(PROFILE)

    const tile = (await screen.findByText('Unfinalized reports')).closest(
      '.stat-tile',
    ) as HTMLElement
    expect(within(tile).getByText('25.0% of their sessions')).toBeInTheDocument()
  })

  it('says so plainly when nothing is outstanding', async () => {
    server.use(
      http.get('/api/instructors/:name', () =>
        HttpResponse.json({ instructor: { ...DANA_DETAIL, unfinalized_sessions: 0 } }),
      ),
    )
    renderApp(PROFILE)

    expect(await screen.findByText('all reports completed')).toBeInTheDocument()
  })

  it('notes how many sessions were shared', async () => {
    renderApp(PROFILE)
    const tile = (await screen.findByText('Sessions taught')).closest('.stat-tile') as HTMLElement
    expect(within(tile).getByText('1 co-taught')).toBeInTheDocument()
  })

  it('collapses the days taught into months rather than listing every date', async () => {
    // 209 dates at the top end of the real data; two here, in different months.
    renderApp(PROFILE)

    const months = within(await card(/Days taught by month/))
    expect(months.getByRole('row', { name: /2026-02/ })).toBeInTheDocument()
    expect(months.getByRole('row', { name: /2026-03/ })).toBeInTheDocument()
  })

  it('counts a month in UTC, so a first-of-the-month day does not slide back', async () => {
    // Midnight UTC on 1 March reads as 28 February in any zone west of UTC, which would
    // file the day under the wrong month.
    server.use(
      http.get('/api/instructors/:name', () =>
        HttpResponse.json({
          instructor: { ...DANA_DETAIL, days_taught: [day('2026-03-01')], total_days_taught: 1 },
        }),
      ),
    )
    renderApp(PROFILE)

    const months = within(await card(/Days taught by month/))
    expect(months.getByRole('row', { name: /2026-03/ })).toBeInTheDocument()
    expect(months.queryByRole('row', { name: /2026-02/ })).not.toBeInTheDocument()
  })

  it('links a roster row straight to that student, with no lookup', async () => {
    const { user } = renderApp(PROFILE)

    const roster = within(await card(/Roster/))
    await user.click(roster.getByRole('link', { name: 'Anthony Nguyen' }))

    await waitFor(() => {
      expect(currentLocation()).toBe(`/students/${encodeURIComponent(ANTHONY_KEY)}`)
    })
  })

  it('shows pages per session, over finalized sessions rather than all of them', async () => {
    // ⚠️ Anthony is 12 pages over 6 sessions, one of which was never finalized and so has
    // no pages to divide. 12 / 5 = 2.4. Dividing by `sessions` would read 2.0 and quietly
    // penalise the instructor for their own paperwork -- the number this test pins.
    renderApp(PROFILE)

    const row = within(await card(/Roster/)).getByRole('row', { name: /Anthony Nguyen/ })
    expect(within(row).getByText('2.4')).toBeInTheDocument()
    expect(within(row).queryByText('2.0')).not.toBeInTheDocument()
  })

  it('dashes the rate where there are too few sessions to call it a pace', async () => {
    // Ava has one session. A rate off a single session is noise, not a pace.
    renderApp(PROFILE)

    const row = within(await card(/Roster/)).getByRole('row', { name: /Ava Nguyen/ })
    expect(within(row).getByText('—')).toBeInTheDocument()
  })

  it('dashes the rate on a roster built before the collection carried the denominator', async () => {
    // ⚠️ The live state until ingestion/build_instructors.py is re-run: Chloe's entry has
    // no finalized_sessions at all. 27 over 9 sessions would look like a perfectly good
    // 3.0, which is exactly the wrong thing to show -- there is nothing to divide by.
    renderApp(PROFILE)

    const row = within(await card(/Roster/)).getByRole('row', { name: /Chloe Tan/ })
    expect(within(row).getByText('—')).toBeInTheDocument()
    expect(within(row).queryByText('3.0')).not.toBeInTheDocument()
  })

  it('does not spend a roster column on the account id', async () => {
    // The row already links to the student by key, and account_id is a household handle --
    // it earns no column next to the figures the roster is read for.
    renderApp(PROFILE)

    const roster = within(await card(/Roster/))
    expect(roster.queryByRole('columnheader', { name: 'Account' })).not.toBeInTheDocument()
    expect(roster.getByRole('columnheader', { name: 'Pages / session' })).toBeInTheDocument()
  })

  it('pages a long roster in the browser', async () => {
    // 304 students is the largest in the real data; the whole roster arrives in one
    // response, so paging it costs no request.
    const students = Array.from({ length: 30 }, (_, i) => ({
      student_key: `key-${i}`,
      student_name: `Student ${String(i).padStart(3, '0')}`,
      account_id: `acct-${i}`,
      sessions: 30 - i,
      pages_completed: i,
    }))
    server.use(
      http.get('/api/instructors/:name', () =>
        HttpResponse.json({
          instructor: { ...DANA_DETAIL, students, unique_students: students.length },
        }),
      ),
    )
    const { user } = renderApp(PROFILE)

    const roster = await card(/Roster/)
    expect(await within(roster).findByText('1–10 of 30')).toBeInTheDocument()

    await user.click(within(roster).getByRole('button', { name: /next/i }))

    expect(await within(roster).findByText('11–20 of 30')).toBeInTheDocument()
    expect(within(roster).getByRole('button', { name: /next/i })).not.toBeDisabled()

    await user.click(within(roster).getByRole('button', { name: /next/i }))

    expect(await within(roster).findByText('21–30 of 30')).toBeInTheDocument()
    expect(within(roster).getByRole('button', { name: /next/i })).toBeDisabled()
  })

  it('says most-taught topics are not available, and why', async () => {
    // Named in the profile spec but unbuildable: the collection carries no topic data.
    renderApp(PROFILE)

    const topics = within(await card(/Most-taught topics/))
    expect(topics.getByText(/carries no topic data/)).toBeInTheDocument()
  })

  it('offers a way back for an unknown instructor', async () => {
    const { user } = renderApp('/instructors/Nobody%20Here')

    expect(await screen.findByText(/Instructor not found/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /back to all instructors/i }))
    await waitFor(() => expect(currentLocation()).toBe('/instructors'))
  })

  it('reports a non-404 failure as an error', async () => {
    server.use(
      http.get('/api/instructors/:name', () =>
        HttpResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      ),
    )
    renderApp(PROFILE)

    expect(await screen.findByRole('alert')).toHaveTextContent('Error 401')
  })
})
