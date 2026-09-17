import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { placeOn, sessionSpan, topicHistories } from '../../src/features/profile/topicHistory'
import type { DwpReport, Topic } from '../../src/api/types'
import { HttpResponse, http } from 'msw'

import { renderApp } from '../support/renderApp'
import { ANTHONY_DETAIL, ANTHONY_KEY, ANTHONY_REPORTS } from '../support/sampleData'
import { server } from '../support/server'

function report(iso: string, topics: { id: string; name: string; status: Topic['status'] }[] | null) {
  return {
    _id: { $oid: iso.replace(/-/g, '').padEnd(24, '0') },
    date: { $date: `${iso}T00:00:00Z` },
    topics,
  } as unknown as DwpReport
}

function topic(id: string, name: string, status: Topic['status'], state: Topic['state']) {
  return { id, name, status, state } as unknown as Topic
}

describe('topic history', () => {
  it('collects the sessions that recorded each topic, oldest first', async () => {
    // Reports arrive newest first; an axis reads the other way.
    const histories = topicHistories(
      [
        report('2026-03-14', [{ id: 'PK-1', name: 'Fractions', status: 'Mastered' }]),
        report('2026-03-01', [{ id: 'PK-1', name: 'Fractions', status: 'Worked On' }]),
      ],
      [topic('PK-1', 'Fractions', 'Mastered', 'finished')],
    )

    expect(histories[0].observations.map((o) => o.iso)).toEqual(['2026-03-01', '2026-03-14'])
  })

  it('skips the reports that recorded no topics at all', async () => {
    // A fifth of reports carry none -- so some gaps are an absent record, not an absent
    // session, and reading `topics` without the null check throws on them.
    const histories = topicHistories(
      [report('2026-03-14', null), report('2026-03-01', [{ id: 'PK-1', name: 'F', status: 'Worked On' }])],
      [topic('PK-1', 'F', 'Worked On', 'on_plan')],
    )

    expect(histories[0].observations).toHaveLength(1)
  })

  it('takes the current status from the aggregate, not from the last session', async () => {
    // ⚠️ The ladder is not written cumulatively: a mastered topic is almost never also
    // written Completed, so the newest mark is what one day said while the aggregate is
    // what the builder concluded across the whole history. They disagree here on purpose.
    const histories = topicHistories(
      [report('2026-03-14', [{ id: 'PK-1', name: 'F', status: 'Worked On' }])],
      [topic('PK-1', 'F', 'Mastered', 'finished')],
    )

    expect(histories[0].status).toBe('Mastered')
    expect(histories[0].observations[0].status).toBe('Worked On')
  })

  it('spans the student’s own sessions', async () => {
    const span = sessionSpan([report('2026-03-14', null), report('2026-03-04', null)])

    expect(span).toEqual({ start: '2026-03-04', end: '2026-03-14', days: 10 })
  })

  it('places a date along the span as a percentage', async () => {
    const span = sessionSpan([report('2026-03-11', null), report('2026-03-01', null)])!

    expect(placeOn(span, '2026-03-01')).toBe(0)
    expect(placeOn(span, '2026-03-06')).toBe(50)
    expect(placeOn(span, '2026-03-11')).toBe(100)
  })

  it('does not divide by zero for a student with one session', async () => {
    const span = sessionSpan([report('2026-03-01', null)])!

    expect(span.days).toBe(1)
    expect(placeOn(span, '2026-03-01')).toBe(0)
  })
})

describe('topics over time card', () => {
  async function trackRows(): Promise<string[][]> {
    const table = await screen.findByRole('table', { name: /topics over time/i })
    return within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent ?? ''))
  }

  it('opens on what the student is working on now', async () => {
    // Measured before choosing the default: topics on plan are a median of 3 across all 893
    // students and never more than 7, where the whole history runs to 125.
    renderApp(`/students/${ANTHONY_KEY}`)

    const rows = await trackRows()
    expect(rows.length).toBeGreaterThan(0)
    expect(await screen.findByRole('button', { name: /show full history/i })).toBeInTheDocument()
  })

  it('opens the whole history on request', async () => {
    renderApp(`/students/${ANTHONY_KEY}`)
    const current = (await trackRows()).length

    await userEvent.click(screen.getByRole('button', { name: /show full history/i }))

    expect((await trackRows()).length).toBeGreaterThanOrEqual(current)
    expect(screen.getByRole('button', { name: /show current only/i })).toBeInTheDocument()
  })

  it('says a gap is not progress, visibly', async () => {
    // ⚠️ The most important thing on this card, and the README's explicit warning: the
    // source records a status on the sessions a topic was worked and nothing between them.
    // A reader looking at the picture is the one who needs telling, so it is not sr-only.
    renderApp(`/students/${ANTHONY_KEY}`)
    await trackRows()

    const note = await screen.findByText(/a gap is not progress, and not a pause either/i)
    expect(note).toBeInTheDocument()
    expect(note.closest('.sr-only')).toBeNull()
  })

  it('never joins two marks with a line', async () => {
    // A connector is the one thing the data cannot support -- the marks are discrete
    // observations, so there is nothing between them to draw.
    renderApp(`/students/${ANTHONY_KEY}`)
    await trackRows()

    expect(document.querySelector('.topic-track svg')).toBeNull()
    expect(document.querySelector('.topic-track line')).toBeNull()
  })

  it('draws a row with no marks for a topic no session recorded', async () => {
    // The shared fixtures already have one: a topic on the plan that no report mentions.
    // The row still belongs on the chart -- it is on the plan -- and an empty track says
    // so more honestly than dropping it would.
    renderApp(`/students/${ANTHONY_KEY}`)
    await trackRows()

    expect(document.querySelectorAll('.topic-track-row')).toHaveLength(1)
    expect(document.querySelectorAll('.topic-mark')).toHaveLength(0)
  })

  it('carries each observation’s date and status on the mark itself', async () => {
    // Driven from an explicit pair rather than the shared fixtures, whose on-plan topic is
    // deliberately one no report recorded -- there would be no mark to inspect.
    server.use(
      http.get(`/api/students/${ANTHONY_KEY}`, () =>
        HttpResponse.json({
          // ANTHONY_DETAIL is the student itself; the route wraps it in an envelope.
          student: {
            ...ANTHONY_DETAIL,
            topics: [
              {
                ...ANTHONY_DETAIL.topics[0],
                id: 'PK-9000-00',
                name: 'Long Division',
                status: 'Mastered',
                state: 'on_plan',
              },
            ],
          },
          stats: { total_dwp_reports: 1 },
          dwp_reports: [
            {
              ...ANTHONY_REPORTS[0],
              date: { $date: '2026-03-10T00:00:00Z' },
              topics: [{ id: 'PK-9000-00', name: 'Long Division', status: 'Worked On' }],
            },
          ],
        }),
      ),
    )

    const { user } = renderApp(`/students/${ANTHONY_KEY}`)
    await trackRows()

    const mark = document.querySelector('.topic-mark') as HTMLElement
    await user.click(mark)

    const card = document.body.querySelector('[role="tooltip"]') as HTMLElement
    expect(card).toHaveTextContent('Long Division')
    expect(within(card).getByText('March 10, 2026')).toBeInTheDocument()
    expect(within(card).getByText('Worked On')).toBeInTheDocument()
    expect(document.querySelector('.topic-now')?.textContent).toBe('Mastered')
  })
})
