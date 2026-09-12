import { HttpResponse, http } from 'msw'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { currentLocation, renderApp } from '../support/renderApp'
import { server } from '../support/server'

/**
 * The tile with this label, scoped to the tile row -- "Students" and "Instructors" are
 * also sidebar items and card titles, so an unscoped lookup is ambiguous on this page.
 */
async function tile(label: string): Promise<HTMLElement> {
  const row = await screen.findByTestId('tile-row')
  return within(row).getByText(label).closest('.stat-tile') as HTMLElement
}

function sessionsCard() {
  return screen.getByRole('heading', { name: 'Sessions' }).closest('.card') as HTMLElement
}

function sessionRows() {
  return within(sessionsCard()).getAllByRole('row').slice(1)
}

function studentsCard() {
  return screen
    .getByRole('heading', { name: /Students · all-time/ })
    .closest('.card') as HTMLElement
}

describe('center metrics page', () => {
  it('opens on every center, with the totals counted from the sessions', async () => {
    renderApp('/metrics')

    // Four reports across both centers, two students, and Marcus teaches at both.
    expect(within(await tile('Sessions')).getByText('4')).toBeInTheDocument()
    expect(within(await tile('Students')).getByText('2')).toBeInTheDocument()
    expect(within(await tile('Instructors')).getByText('2')).toBeInTheDocument()
    expect(within(await tile('Pages completed')).getByText('11')).toBeInTheDocument()
  })

  it('says how many days those sessions fall on, which is the smaller number', async () => {
    // 70 student-days in the real data carry more than one session. A tile reading
    // "4 sessions" over "3 days" is the difference stated rather than left to be assumed.
    renderApp('/metrics')
    expect(within(await tile('Sessions')).getByText('across 3 days')).toBeInTheDocument()
  })

  it('puts the chosen center in the URL and narrows every figure to it', async () => {
    const { user } = renderApp('/metrics')

    await user.click(await screen.findByRole('button', { name: 'Westside' }))

    await waitFor(() => expect(currentLocation()).toBe('/metrics?center=Westside'))
    await waitFor(async () =>
      expect(within(await tile('Sessions')).getByText('2')).toBeInTheDocument(),
    )
    expect(within(await tile('Students')).getByText('1')).toBeInTheDocument()
  })

  it('counts an instructor at two selected centers once, not twice', async () => {
    /**
     * ⚠️ Marcus teaches at Westside and at Eastside. Each center on its own answers for
     * him, so the per-center counts are 2 and 1 -- and the union is 2, not 3. The center
     * filter is a union and not a partition; 11 of 103 instructors are in this position.
     */
    const { user } = renderApp('/metrics')

    await user.click(await screen.findByRole('button', { name: 'Westside' }))
    await waitFor(async () =>
      expect(within(await tile('Instructors')).getByText('2')).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: 'Eastside' }))
    await waitFor(() =>
      expect(currentLocation()).toBe('/metrics?center=Westside&center=Eastside'),
    )
    expect(within(await tile('Instructors')).getByText('2')).toBeInTheDocument()
  })

  it('goes back to every center when the selection is cleared', async () => {
    const { user } = renderApp('/metrics?center=Westside')

    await user.click(await screen.findByRole('button', { name: 'All centers' }))

    await waitFor(() => expect(currentLocation()).toBe('/metrics'))
    expect(within(await tile('Sessions')).getByText('4')).toBeInTheDocument()
  })

  it('opens on the most recent day of sessions rather than on everything', async () => {
    /**
     * Against a live database this card would open on today. The imported data ends well
     * before the calendar does -- 2025-09-17 in production, 2026-03-14 in these fixtures --
     * so the equivalent is its newest session date. Opening on Any time buries the day a
     * manager actually came to look at under a year of history.
     */
    renderApp('/metrics')

    // Both of the Mar 14 sessions, and neither the Mar 10 nor the Jan 5 one.
    await waitFor(() => expect(sessionRows()).toHaveLength(2))
    expect(within(sessionsCard()).getByText('Anthony Nguyen')).toBeInTheDocument()
    expect(within(sessionsCard()).getByText('Chloe Tan')).toBeInTheDocument()
  })

  it('names that day as a date, not as a range from itself to itself', async () => {
    // The pill is the only thing saying the card holds one day and not the lot, so it has
    // to read like a date. "Mar 14, 2026 to Mar 14, 2026" is the same fact said twice.
    renderApp('/metrics')

    expect(
      await screen.findByRole('button', { name: 'Filter by session date: Mar 14, 2026' }),
    ).toBeInTheDocument()
  })

  it('anchors on the selected centers, not on the whole dataset', async () => {
    /**
     * ⚠️ Today every center ran on the same last day, so a dataset-wide anchor would look
     * right. The moment one center closes or lags an import it would open that center's
     * card empty -- a quiet day and a broken card being indistinguishable.
     */
    server.use(
      http.get('/api/centers/metrics', () =>
        HttpResponse.json({
          centers: ['Eastside'],
          totals: {
            sessions: 2, students: 1, instructors: 1, pages_completed: 4,
            unfinalized: 1, days: 2,
            first_session: { $date: '2026-01-05T00:00:00Z' },
            last_session: { $date: '2026-01-05T00:00:00Z' },
          },
        }),
      ),
    )
    renderApp('/metrics?center=Eastside')

    expect(
      await screen.findByRole('button', { name: 'Filter by session date: Jan 5, 2026' }),
    ).toBeInTheDocument()
    await waitFor(() => expect(sessionRows()).toHaveLength(1))
    expect(within(sessionsCard()).getByText('Chloe Tan')).toBeInTheDocument()
  })

  it('widens off that day when asked, and leaves the other cards alone', async () => {
    /**
     * ⚠️ The range is deliberately the sessions card's own, not the page's. The student
     * and instructor cards read all-time aggregates that cannot answer a period, and a
     * control that appeared to narrow them would be claiming something untrue.
     */
    const { user } = renderApp('/metrics')

    await waitFor(() => expect(sessionRows()).toHaveLength(2))
    const studentRowsBefore = within(studentsCard()).getAllByRole('row').length

    await user.click(
      screen.getByRole('button', { name: 'Filter by session date: Mar 14, 2026' }),
    )
    const from = await screen.findByLabelText(/earliest session date/i)
    await user.clear(from)
    await user.type(from, '2026-03-10')
    await user.clear(await screen.findByLabelText(/latest session date/i))
    await user.click(screen.getByRole('button', { name: /^apply$/i }))

    // Mar 10 joins the two Mar 14 sessions; Jan 5 is still outside the window.
    await waitFor(() => expect(sessionRows()).toHaveLength(3))
    expect(within(studentsCard()).getAllByRole('row')).toHaveLength(studentRowsBefore)
    expect(within(await tile('Sessions')).getByText('4')).toBeInTheDocument()
    // The card owns the range, so it never reaches the address bar.
    expect(currentLocation()).toBe('/metrics')
  })

  it('shows every session once the filter is cleared', async () => {
    // Clear means Any time here as it does on every other filter -- the way back out of
    // the default, rather than a control that returns to it.
    const { user } = renderApp('/metrics')

    await waitFor(() => expect(sessionRows()).toHaveLength(2))
    await user.click(
      screen.getByRole('button', { name: 'Filter by session date: Mar 14, 2026' }),
    )
    await user.click(await screen.findByRole('button', { name: /^clear$/i }))

    await waitFor(() => expect(sessionRows()).toHaveLength(4))
    expect(
      screen.getByRole('button', { name: /filter by session date: any time/i }),
    ).toBeInTheDocument()
  })

  it('stays usable on Any time when the anchor never arrives', async () => {
    // The tiles carry their own error. The card must not sit on "Loading…" forever
    // waiting for a day it is never going to be told.
    server.use(
      http.get('/api/centers/metrics', () =>
        HttpResponse.json({ error: 'Server error' }, { status: 500 }),
      ),
    )
    renderApp('/metrics')

    await waitFor(() => expect(sessionRows()).toHaveLength(4))
    expect(
      screen.getByRole('button', { name: /filter by session date: any time/i }),
    ).toBeInTheDocument()
  })

  it('opens a session in a dialog carrying the notes the list withholds', async () => {
    /**
     * ⚠️ The modal refetches from /api/reports/<id>. The list route strips student_notes
     * by projection, so a dialog built from the row in hand would render that block empty
     * and read as a child with nothing recorded.
     */
    const { user } = renderApp('/metrics')

    const open = await screen.findByRole('button', {
      name: /open the mar 14, 2026 session for anthony nguyen/i,
    })
    await user.click(open)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('link', { name: 'Anthony Nguyen' })).toBeInTheDocument()
    expect(await within(dialog).findByText('Prefers worked examples first.')).toBeInTheDocument()
    // The record, not a summary of it: the detail page's field grid comes with it.
    expect(within(dialog).getByText('Session of the month')).toBeInTheDocument()
  })

  it('closes the dialog on Escape and puts focus back on the row that opened it', async () => {
    const { user } = renderApp('/metrics')

    const open = await screen.findByRole('button', {
      name: /open the mar 14, 2026 session for anthony nguyen/i,
    })
    await user.click(open)
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Without this the reader is dropped on <body> and restarts from the top of the page.
    expect(
      screen.getByRole('button', { name: /open the mar 14, 2026 session for anthony nguyen/i }),
    ).toHaveFocus()
  })

  it('closes the dialog from its own button', async () => {
    const { user } = renderApp('/metrics')

    await user.click(
      await screen.findByRole('button', {
        name: /open the mar 14, 2026 session for anthony nguyen/i,
      }),
    )
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('says what went wrong on the tiles, and shows no figures', async () => {
    server.use(
      http.get('/api/centers/metrics', () =>
        HttpResponse.json(
          { error: 'Server error', detail: 'Set API_KEY in .env -- see .env.example' },
          { status: 500 },
        ),
      ),
    )
    renderApp('/metrics')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Error 500')
    expect(screen.queryByTestId('tile-row')).not.toBeInTheDocument()
  })

  it('is reachable from the sidebar', async () => {
    renderApp('/metrics')

    const nav = await screen.findByRole('link', { name: 'Metrics' })
    expect(nav).toHaveAttribute('href', '/metrics')
    expect(nav).toHaveClass('nav-item-active')
  })
})
