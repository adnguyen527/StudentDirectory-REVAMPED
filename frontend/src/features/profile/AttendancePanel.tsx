import { useState } from 'react'

import { formatNumber, toDate } from '../../api/bson'
import type { ExtDate } from '../../api/bson'
import { getStudentAttendance } from '../../api/endpoints'
import type { AttendanceResponse } from '../../api/types'
import { useApi } from '../../hooks/useApi'
import { AsyncBoundary } from '../../shell/AsyncBoundary'
import { Card } from '../../shell/Card'
import './Profile.css'

/** 'YYYY-MM-DD' in UTC, which is what <input type="date"> and the route both speak. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * The three months ending at the student's last session -- not at today.
 *
 * The route refuses to default the window on purpose: "this month" silently returns
 * nothing whenever the imported data lags the calendar. The data currently ends
 * 2025-09-17, so anchoring on today would open this panel empty on every student and
 * read as a broken endpoint. Anchoring on their last session always shows something real.
 */
function defaultPeriod(lastSessionDate: ExtDate | null): { start: string; end: string } {
  const end = toDate(lastSessionDate) ?? new Date()
  const start = new Date(end)
  start.setMonth(start.getMonth() - 3)
  return { start: isoDay(start), end: isoDay(end) }
}

interface AttendancePanelProps {
  studentKey: string
  lastSessionDate: ExtDate | null
}

/**
 * Sessions attended over a selectable period, so a manager can tell a parent what their
 * prepaid package has used.
 *
 * Consumption, not balance: how many sessions were used. How many were purchased lives in
 * billing, which this system does not hold.
 */
export function AttendancePanel({ studentKey, lastSessionDate }: AttendancePanelProps) {
  const [period, setPeriod] = useState(() => defaultPeriod(lastSessionDate))

  // Caught here rather than sent: the route answers 400, and an error box is a worse
  // answer than the field simply refusing an impossible range.
  const invalid = period.start > period.end

  const { data, loading, error } = useApi<AttendanceResponse | null>(
    (signal) =>
      invalid
        ? Promise.resolve(null)
        : getStudentAttendance(studentKey, period.start, period.end, signal),
    [studentKey, period.start, period.end, invalid],
  )

  return (
    <Card
      title="Sessions in a period"
      controls={
        <div className="period">
          <input
            type="date"
            className="period-input"
            aria-label="Period start"
            value={period.start}
            onChange={(event) => setPeriod((p) => ({ ...p, start: event.target.value }))}
          />
          <span className="muted">to</span>
          <input
            type="date"
            className="period-input"
            aria-label="Period end"
            value={period.end}
            onChange={(event) => setPeriod((p) => ({ ...p, end: event.target.value }))}
          />
        </div>
      }
    >
      {invalid ? (
        <p className="state">The start date is after the end date.</p>
      ) : (
        <AsyncBoundary
          loading={loading}
          error={error}
          empty={data?.visits.length === 0}
          emptyMessage="No sessions attended in this period."
        >
          <div className="attendance-totals">
            <div>
              <div className="attendance-figure">{formatNumber(data?.totals.sessions)}</div>
              <div className="muted">sessions</div>
            </div>
            <div>
              <div className="attendance-figure">{formatNumber(data?.totals.days)}</div>
              <div className="muted">days attended</div>
            </div>
          </div>

          <table className="table attendance-months">
            <thead>
              <tr>
                <th>Month</th>
                <th className="numeric">Sessions</th>
                <th className="numeric">Days</th>
              </tr>
            </thead>
            <tbody>
              {data?.by_month.map((month) => (
                <tr key={month.month}>
                  <td>{month.month}</td>
                  <td className="numeric">{formatNumber(month.sessions)}</td>
                  <td className="numeric">{formatNumber(month.days)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </AsyncBoundary>
      )}
    </Card>
  )
}
