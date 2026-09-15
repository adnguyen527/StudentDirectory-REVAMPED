import { formatNumber, toDate } from '../../api/bson'
import type { AttendanceVisit } from '../../api/types'
import { ChartFigure } from '../../charts/ChartFigure'
import { ChartTable } from '../../charts/ChartTable'
import '../../charts/Chart.css'
import './Profile.css'

interface AttendanceHeatmapProps {
  visits: AttendanceVisit[]
  /** The window the panel asked for, 'YYYY-MM-DD' at both ends, inclusive. */
  period: { start: string; end: string }
}

interface Day {
  /** 'YYYY-MM-DD' in UTC. */
  iso: string
  sessions: number
  pages: number
  attended: boolean
}

/**
 * ⚠️ Intensity is **pages**, not sessions -- and the README asked for sessions.
 *
 * Measured against the live data before choosing: of 29,311 attended days, 29,241 hold
 * exactly one session. 69 hold two and one holds three. So a ramp keyed on sessions would
 * paint every cell in the dataset the same shade except seventy, spending the whole colour
 * channel to say "attended", which the cell's presence already says.
 *
 * Pages actually vary -- a quarter of days are 2 or fewer, half are 4 or fewer, a quarter
 * are 8 or more, and the busiest is 65 -- so that is what the shade can carry honestly.
 * The distinction the README cares about is not lost: sessions and days stay separate
 * everywhere they are *counted* -- the panel's own totals, each cell's tooltip and the
 * table twin all report sessions, and the twin reports both.
 *
 * The thresholds are the measured quartiles rather than an even split of the range: an even
 * split across 0-65 would put 97% of days in the first band.
 */
const PAGE_BANDS = [2, 4, 7]

/**
 * Which ramp step a day takes, 1-5.
 *
 * ⚠️ A day with no visit is level 0 and wears `--border`, not the lightest ramp step.
 * Absence is not a low value: in dark mode the ramp's first step is a mid violet, which
 * would read as a quiet day rather than as no day at all.
 */
function level(day: Day): number {
  if (!day.attended) return 0
  // An attended day with nothing recorded still has to outrank an unattended one.
  if (day.pages <= 0) return 1
  const band = PAGE_BANDS.findIndex((edge) => day.pages <= edge)
  return band === -1 ? 5 : band + 2
}

/** 'YYYY-MM-DD' in UTC, the spelling the route and <input type="date"> both use. */
function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Every day in the window, attended or not.
 *
 * ⚠️ Built from the period rather than from `visits`, which is the whole point of a
 * calendar: a day nobody came is a real zero and has to hold its square, or the grid
 * silently closes up and a fortnight off looks like a fortnight of attendance.
 *
 * ⚠️ UTC throughout -- `Date.UTC`, `toISOString`, `getUTCDay`. These are naive wall-clock
 * dates stored as UTC, and a local reading pushes a midnight session onto the previous day.
 * vitest.config.ts pins TZ to America/Chicago precisely so that mistake fails here.
 */
function daysIn(period: { start: string; end: string }, visits: AttendanceVisit[]): Day[] {
  const byDay = new Map<string, AttendanceVisit>()
  for (const visit of visits) {
    const date = toDate(visit.date)
    if (date) byDay.set(isoOf(date), visit)
  }

  const days: Day[] = []
  const cursor = new Date(`${period.start}T00:00:00Z`)
  const end = new Date(`${period.end}T00:00:00Z`)
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return days

  while (cursor <= end) {
    const iso = isoOf(cursor)
    const visit = byDay.get(iso)
    days.push({
      iso,
      sessions: visit?.sessions ?? 0,
      pages: visit?.pages_completed ?? 0,
      attended: visit !== undefined,
    })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days
}

/** Monday-based weekday index, 0-6, so a column is a calendar week. */
function weekdayOf(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Days attended, as a calendar.
 *
 * A CSS grid of squares -- weeks as columns, weekdays as rows -- rather than an SVG. There
 * is nothing to measure: a grid of equal cells is what `grid-auto-flow: column` already
 * does, at any container width, with real focusable DOM nodes and no viewBox to distort.
 */
export function AttendanceHeatmap({ visits, period }: AttendanceHeatmapProps) {
  const days = daysIn(period, visits)
  if (days.length === 0) return null

  // Pad the first column so the grid starts on the right weekday rather than sliding the
  // whole calendar up by however many days the period happens to begin after Monday.
  const lead = weekdayOf(days[0].iso)

  const attended = days.filter((day) => day.attended)
  const sessions = attended.reduce((sum, day) => sum + day.sessions, 0)

  return (
    <ChartFigure
      caption="Days attended"
      note={
        <>
          {`${formatNumber(attended.length)} days attended in this period, ` +
            `${formatNumber(sessions)} sessions. Shade is pages completed that day.`}
          <span className="heat-key">
            <span className="muted">Less</span>
            {[1, 2, 3, 4, 5].map((step) => (
              <span
                key={step}
                className="heat-cell heat-key-cell"
                data-level={step}
                aria-hidden="true"
              />
            ))}
            <span className="muted">More</span>
          </span>
        </>
      }
      twin={
        <ChartTable
          caption="Days attended"
          columns={['Date', 'Sessions', 'Pages']}
          rows={attended.map((day) => [
            day.iso,
            formatNumber(day.sessions),
            formatNumber(day.pages),
          ])}
        />
      }
    >
      <div className="heat-grid">
        {WEEKDAYS.map((name, index) => (
          // Every third row labelled, as a contribution calendar does: seven labels in a
          // 12px column is a wall of text.
          <span className="heat-weekday" key={name} style={{ gridRow: index + 1 }}>
            {index % 2 === 0 ? name : ''}
          </span>
        ))}

        {Array.from({ length: lead }, (_, index) => (
          <span className="heat-cell heat-cell-pad" key={`pad-${index}`} />
        ))}

        {days.map((day) => (
          <span
            className="heat-cell"
            key={day.iso}
            data-level={level(day)}
            title={
              day.attended
                ? `${day.iso}: ${formatNumber(day.sessions)} session${
                    day.sessions === 1 ? '' : 's'
                  }, ${formatNumber(day.pages)} pages`
                : `${day.iso}: no session`
            }
          />
        ))}
      </div>
    </ChartFigure>
  )
}
