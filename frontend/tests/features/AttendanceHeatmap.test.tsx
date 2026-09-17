import { HttpResponse, http } from 'msw'
import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderApp } from '../support/renderApp'
import { ANTHONY_KEY } from '../support/sampleData'
import { server } from '../support/server'

/**
 * The attendance calendar on the student profile.
 *
 * ⚠️ vitest.config.ts pins TZ to America/Chicago (UTC-5/-6). That is what makes the
 * boundary test below mean something: a midnight-UTC date read with a local getter lands on
 * the previous evening, so a session stored at 2026-03-14T00:00:00Z would be drawn on the
 * 13th. On a UTC machine -- most CI -- both readings agree and the bug would ship.
 */

/**
 * Cells in the calendar itself.
 *
 * Scoped to .heat-grid: the legend under the chart reuses .heat-cell with the same
 * data-level, so an unscoped query counts the key's swatches as days.
 */
function gridCells(level?: string) {
  const selector = level
    ? `.heat-grid .heat-cell[data-level="${level}"]`
    : '.heat-grid .heat-cell:not(.heat-cell-pad)'
  return document.querySelectorAll(selector)
}

/** The heatmap's twin as [date, sessions, pages] rows. */
async function heatRows(): Promise<string[][]> {
  const table = await screen.findByRole('table', { name: /days attended/i })
  return within(table)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent ?? ''))
}

function visit(iso: string, sessions: number, pages: number | null) {
  return {
    _id: { $oid: iso.replace(/-/g, '').padEnd(24, '0') },
    date: { $date: `${iso}T00:00:00Z` },
    centers: ['Westside'],
    instructors: ['Dana Reyes'],
    delivery_methods: ['In-Center'],
    sessions,
    sessions_timed: sessions,
    minutes_present: 60,
    pages_completed: pages,
    first_session_start: { $date: `${iso}T16:00:00Z` },
    last_session_end: { $date: `${iso}T17:00:00Z` },
  }
}

function withAttendance(start: string, end: string, visits: ReturnType<typeof visit>[]) {
  server.use(
    http.get(`/api/students/${ANTHONY_KEY}/attendance`, () =>
      HttpResponse.json({
        student: { student_key: ANTHONY_KEY, student_name: 'Anthony Nguyen', account_id: 'a' },
        period: { start, end },
        totals: {
          sessions: visits.reduce((sum, v) => sum + v.sessions, 0),
          days: visits.length,
        },
        by_month: [],
        visits,
      }),
    ),
  )
}

describe('attendance heatmap', () => {
  it('puts a session on its UTC day, not the local one before it', async () => {
    // ⚠️ The regression this file exists for. Midnight UTC on the 14th is 6pm on the 13th
    // in the pinned zone, so any local date getter draws this cell a day early.
    withAttendance('2026-03-09', '2026-03-15', [visit('2026-03-14', 1, 5)])
    renderApp(`/students/${ANTHONY_KEY}`)

    expect(await heatRows()).toEqual([['2026-03-14', '1', '5']])
  })

  it('draws a square for every day in the period, attended or not', async () => {
    // A calendar that skipped the empty days would close up, and a fortnight off would
    // look like a fortnight of attendance.
    withAttendance('2026-03-09', '2026-03-15', [visit('2026-03-10', 1, 4)])
    renderApp(`/students/${ANTHONY_KEY}`)

    await heatRows()
    expect(gridCells()).toHaveLength(7)
    // One attended, six not -- and an unattended day is level 0, not a faint ramp step.
    expect(gridCells('0')).toHaveLength(6)
  })

  it('keeps an attended day with no pages ahead of a day nobody came', async () => {
    // 3,224 attended days in the live data record no pages. They are not absences.
    withAttendance('2026-03-09', '2026-03-10', [visit('2026-03-10', 1, 0)])
    renderApp(`/students/${ANTHONY_KEY}`)

    await heatRows()
    expect(gridCells('1')).toHaveLength(1)
    expect(gridCells('0')).toHaveLength(1)
  })

  it('shades by pages, across the measured bands', async () => {
    // Intensity is pages because sessions barely vary -- 29,241 of 29,311 attended days
    // hold exactly one. The bands are the live quartiles: 2, 4, 7.
    withAttendance('2026-03-09', '2026-03-13', [
      visit('2026-03-09', 1, 1),
      visit('2026-03-10', 1, 4),
      visit('2026-03-11', 1, 6),
      visit('2026-03-12', 1, 30),
    ])
    renderApp(`/students/${ANTHONY_KEY}`)

    await heatRows()
    for (const level of ['2', '3', '4', '5']) {
      expect(gridCells(level)).toHaveLength(1)
    }
  })

  it('keeps sessions and days distinct in the accessible table', async () => {
    // ⚠️ A day is not a session: 70 student-days in the live data carry more than one.
    withAttendance('2026-03-09', '2026-03-11', [
      visit('2026-03-10', 2, 9),
      visit('2026-03-11', 1, 3),
    ])
    renderApp(`/students/${ANTHONY_KEY}`)

    expect(await heatRows()).toEqual([
      ['2026-03-10', '2', '9'],
      ['2026-03-11', '1', '3'],
    ])
    expect(await screen.findByText(/shade is pages completed that day/i)).toBeInTheDocument()
  })

  it('says what the shade means, so the ramp is not read as sessions', async () => {
    withAttendance('2026-03-09', '2026-03-10', [visit('2026-03-10', 1, 4)])
    renderApp(`/students/${ANTHONY_KEY}`)

    expect(await screen.findByText(/shade is pages completed that day/i)).toBeInTheDocument()
  })

  it('carries the exact counts in each cell, not only in the shade', async () => {
    withAttendance('2026-03-10', '2026-03-10', [visit('2026-03-10', 1, 4)])
    const { user } = renderApp(`/students/${ANTHONY_KEY}`)

    await heatRows()
    const cell = gridCells()[0] as HTMLElement
    await user.click(cell)

    const card = document.body.querySelector('[role="tooltip"]') as HTMLElement
    expect(card).toHaveTextContent('March 10, 2026')
    expect(within(card).queryByText('Sessions')).not.toBeInTheDocument()
    expect(within(card).getByText('Pages')).toBeInTheDocument()
    // The tooltip shows only the page value, not the session counter.
    const values = within(card).getAllByRole('definition')
    expect(values.map((el) => el.textContent)).toEqual(['4'])
  })

  it('names the shade an unattended day carries instead', async () => {
    withAttendance('2026-03-09', '2026-03-10', [visit('2026-03-10', 1, 4)])
    const { user } = renderApp(`/students/${ANTHONY_KEY}`)

    await heatRows()
    const unattended = gridCells('0')[0] as HTMLElement
    await user.click(unattended)

    const card = document.body.querySelector('[role="tooltip"]') as HTMLElement
    expect(card).toHaveTextContent('No session')
  })

  it('labels each month under the column where its first day appears', async () => {
    withAttendance('2026-01-25', '2026-03-15', [visit('2026-01-30', 1, 2)])
    renderApp(`/students/${ANTHONY_KEY}`)

    await heatRows()
    expect(document.querySelectorAll('.heat-month')).toHaveLength(2)
    expect(document.querySelectorAll('.heat-grid .heat-month')).toHaveLength(0)
    expect(screen.getByText('Feb', { selector: '.heat-month' })).toBeInTheDocument()
    expect(screen.getByText('Mar', { selector: '.heat-month' })).toBeInTheDocument()
  })
})
