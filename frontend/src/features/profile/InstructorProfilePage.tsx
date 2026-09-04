import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { formatDate, formatNumber, toDate } from '../../api/bson'
import { getInstructor } from '../../api/endpoints'
import type { ExtDate } from '../../api/bson'
import type { InstructorDetailResponse, InstructorRosterEntry } from '../../api/types'
import { useApi } from '../../hooks/useApi'
import { AsyncBoundary } from '../../shell/AsyncBoundary'
import { Card } from '../../shell/Card'
import { CardRow } from '../../shell/CardRow'
import { ChevronIcon, DashboardIcon, InstructorsIcon, StudentsIcon } from '../../shell/Icons'
import { Pager } from '../../shell/Pager'
import { StatTile } from '../../shell/StatTile'
import { useDocumentTitle } from '../../shell/useDocumentTitle'
import { PAGES_PER_SESSION_MIN, pagesPerSession } from './pagesPerSession'
import './Profile.css'

/** Matches the topic page's instructor table. 91% of rosters need more than one page --
 *  the median is 62 students and the widest 304, which is 31 pages. */
const ROSTER_PAGE = 10

/** days_taught -> [{month: 'YYYY-MM', days}], oldest first. */
function daysByMonth(days: ExtDate[]): { month: string; days: number }[] {
  const buckets = new Map<string, number>()
  for (const day of days) {
    const date = toDate(day)
    if (!date) continue
    // UTC, like every other date here -- these are naive wall clocks, and a local read
    // would push a 1st-of-the-month day into the previous month.
    const month = date.toISOString().slice(0, 7)
    buckets.set(month, (buckets.get(month) ?? 0) + 1)
  }
  return [...buckets.entries()]
    .map(([month, count]) => ({ month, days: count }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

/**
 * One instructor: what they have taught, who they have taught, and what is outstanding.
 *
 * Keyed on the name, which is all the source data carries -- so two people sharing one
 * are merged here and nothing can separate them.
 */
/**
 * The pages-per-session cell, or the dash that stands in for no rate.
 *
 * Two ways to have no rate, and they are the same answer on screen: fewer than
 * PAGES_PER_SESSION_MIN sessions together, or a roster document built before the
 * `instructors` collection carried finalized_sessions at all.
 */
function rate(entry: InstructorRosterEntry) {
  const value = pagesPerSession(entry)
  if (value === null) return <span className="muted">—</span>
  return value.toFixed(1)
}

export function InstructorProfilePage() {
  const { instructorName = '' } = useParams()
  const [rosterOffset, setRosterOffset] = useState(0)

  const { data, loading, error } = useApi<InstructorDetailResponse>(
    (signal) => getInstructor(instructorName, signal),
    [instructorName],
  )

  const instructor = data?.instructor
  const months = useMemo(() => daysByMonth(instructor?.days_taught ?? []), [instructor])

  // Named for the record, not the route: a row of tabs and the Back menu are only useful
  // if they say which student. Null while it loads, so the previous title holds rather
  // than flashing the wordmark between two real names.
  useDocumentTitle(error?.status === 404 ? 'Instructor not found' : instructor?.instructor_name ?? null)

  if (error?.status === 404) {
    return (
      <div className="page">
        <Card title="Instructor not found" showOverflow={false}>
          <p className="muted">
            No instructor named <code>{instructorName}</code>.
          </p>
          <p className="profile-back-block">
            <Link className="button" to="/instructors">
              Back to all instructors
            </Link>
          </p>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page">
        <div className="state-error" role="alert">
          <strong>{error.status ? `Error ${error.status}` : 'Cannot reach the API'}</strong>
          {error.displayMessage}
        </div>
      </div>
    )
  }

  if (loading || !instructor) {
    return (
      <div className="page">
        <p className="state">Loading instructor…</p>
      </div>
    )
  }

  // One element serves instructors/:instructorName, so the offset survives a move to
  // another instructor. Snap back when it no longer addresses a row, rather than resetting
  // in an effect and paying a second render pass.
  const offset = rosterOffset < instructor.students.length ? rosterOffset : 0
  const roster = instructor.students.slice(offset, offset + ROSTER_PAGE)
  // The detail response carries the arrays, so it counts them rather than being told.
  const daysTaught = instructor.days_taught.length
  const rosterSize = instructor.students.length
  const perDay = daysTaught ? instructor.total_sessions_taught / daysTaught : 0
  const unfinalizedShare = instructor.total_sessions_taught
    ? (100 * instructor.unfinalized_sessions) / instructor.total_sessions_taught
    : 0

  return (
    <div className="page">
      <div className="page-header">
        <Link className="profile-back" to="/instructors">
          <ChevronIcon className="profile-back-icon" />
          All instructors
        </Link>
        <h1>{instructor.instructor_name}</h1>
        <p>
          {instructor.centers.map((center) => (
            <span key={center.name} className="tag profile-center">
              {center.name} · {formatNumber(center.sessions)}
            </span>
          ))}
          <span className="muted">last taught {formatDate(instructor.last_session_date)}</span>
        </p>
      </div>

      <div className="tile-row">
        <StatTile
          label="Sessions taught"
          value={formatNumber(instructor.total_sessions_taught)}
          sub={
            instructor.co_taught_sessions > 0
              ? `${formatNumber(instructor.co_taught_sessions)} co-taught`
              : undefined
          }
          icon={<InstructorsIcon size={22} />}
          wash={1}
        />
        <StatTile
          label="Students taught"
          value={formatNumber(rosterSize)}
          icon={<StudentsIcon size={22} />}
          wash={2}
        />
        <StatTile
          label="Days taught"
          value={formatNumber(daysTaught)}
          sub={`${perDay.toFixed(1)} sessions per day`}
          icon={<DashboardIcon size={22} />}
          wash={3}
        />
        {/* The one figure here that is a to-do rather than a statistic. Shown as a share
            as well as a count, because 19 unfinalized means something different against
            137 sessions than against 1,144. */}
        <StatTile
          label="Unfinalized reports"
          value={formatNumber(instructor.unfinalized_sessions)}
          sub={
            instructor.unfinalized_sessions > 0
              ? `${unfinalizedShare.toFixed(1)}% of their sessions`
              : 'all reports completed'
          }
          icon={<DashboardIcon size={22} />}
          wash={4}
        />
      </div>

      {/* Side by side: when they worked and who they worked with are the two halves of
          the same question, and the months table is two columns of numbers that spent a
          full-width row saying very little. */}
      <CardRow>
        <Card title="Days taught by month" flush>
          <AsyncBoundary
            loading={false}
            error={null}
            empty={months.length === 0}
            emptyMessage="No days recorded."
          >
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th className="numeric">Days</th>
                  </tr>
                </thead>
                <tbody>
                  {months.map((month) => (
                    <tr key={month.month}>
                      <td>{month.month}</td>
                      <td className="numeric">{formatNumber(month.days)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AsyncBoundary>
        </Card>

        <Card title={`Roster · ${formatNumber(rosterSize)} students`} flush>
          {instructor.students.length === 0 ? (
            <p className="state">No students on this roster.</p>
          ) : (
            <>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th className="numeric">Sessions</th>
                      <th className="numeric">Pages completed</th>
                      {/* The same figure the student's own profile shows for this pair,
                          from the other side -- see pagesPerSession. */}
                      <th className="numeric">Pages / session</th>
                    </tr>
                  </thead>
                  <tbody>
                    {roster.map((entry) => (
                      <tr key={entry.student_key}>
                        <td className="primary-name">
                          {/* The roster carries student_key, so this links straight through
                              with no lookup. */}
                          <Link
                            className="row-link"
                            to={`/students/${encodeURIComponent(entry.student_key)}`}
                          >
                            {entry.student_name}
                          </Link>
                        </td>
                        <td className="numeric">{formatNumber(entry.sessions)}</td>
                        <td className="numeric">{formatNumber(entry.pages_completed)}</td>
                        {/* A dash, not a zero: under five sessions together there is no
                            pace to quote, and a roster built before the collection grew
                            finalized_sessions has nothing to divide by either. */}
                        <td className="numeric">{rate(entry)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* The same caveat the student's own profile carries for this figure, since
                  it is the same figure read from the other side. */}
              <p className="muted table-footnote">
                * Pages per session is shown from {PAGES_PER_SESSION_MIN} sessions together
                and averages over sessions with a recorded page count, so it will not equal
                pages &divide; sessions where a report was never finalized.
              </p>

              <Pager
                page={{
                  limit: ROSTER_PAGE,
                  offset,
                  total: instructor.students.length,
                  returned: roster.length,
                }}
                onChange={setRosterOffset}
              />
            </>
          )}
        </Card>
      </CardRow>

      {/* Named in the README's profile spec but not buildable: the instructors collection
          carries no topic data, so there is nothing to rank. See the P2 data-integrity
          item "Add most-taught topics to instructors". */}
      <Card title="Most-taught topics" showOverflow={false}>
        <p className="muted">
          Not available yet — the <code>instructors</code> collection carries no topic data,
          so there is nothing to rank. It needs the ranked topic counts added by
          <code> ingestion/build_instructors.py</code> first.
        </p>
      </Card>
    </div>
  )
}
