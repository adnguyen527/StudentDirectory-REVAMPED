import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { formatDate, formatNumber, toDate } from '../../api/bson'
import { getStudent } from '../../api/endpoints'
import type { StudentDetailResponse, StudentInstructor } from '../../api/types'
import { useApi } from '../../hooks/useApi'
import { Card } from '../../shell/Card'
import { CardRow } from '../../shell/CardRow'
import { Pager } from '../../shell/Pager'
import { NumberRangeFilter } from '../NumberRangeFilter'
import { ColumnHeader } from '../SortHeader'
import { useCardRange } from '../ranges'
import { useCardSort } from '../useSort'
import { ChevronIcon, DashboardIcon, InstructorsIcon, StudentsIcon } from '../../shell/Icons'
import { StatTile } from '../../shell/StatTile'
import { useDocumentTitle } from '../../shell/useDocumentTitle'
import { AttendancePanel } from './AttendancePanel'
import { SessionHistoryCard } from './SessionHistoryCard'
import { TopicsCard } from './TopicsCard'
import { PAGES_PER_SESSION_MIN, pagesPerSession } from './pagesPerSession'
import './Profile.css'

/** Matches the other two profile tables. The median student has 9 instructors and the
 *  widest 23, so 43% of profiles need more than one page. */
const INSTRUCTOR_PAGE = 10

/** The value a column is read, sorted and filtered by. */
const INSTRUCTOR_VALUES: Record<string, (row: StudentInstructor) => number | null> = {
  sessions: (row) => row.sessions,
  pages: (row) => row.pages_completed,
  rate: pagesPerSession,
}

/** Rows within a bound, with the rows that have no value left out -- see range_criteria. */
function withinBound(rows: StudentInstructor[], column: string, low: string, high: string) {
  if (!low && !high) return rows
  const valueOf = INSTRUCTOR_VALUES[column]
  return rows.filter((row) => {
    const value = valueOf(row)
    if (value === null) return false
    if (low && value < Number(low)) return false
    if (high && value > Number(high)) return false
    return true
  })
}

/**
 * One student, everything the API holds about them.
 *
 * A single request carries it all -- the aggregate document plus every session report --
 * which is what makes this page frontend-only. The cost is the response size: the
 * heaviest student in the current data is 149 sessions at roughly 229 KB. One request per
 * view, and nothing in the dataset is larger, so it is accepted rather than worked around.
 */
export function StudentProfilePage() {
  const { studentKey = '' } = useParams()
  const [instructorOffset, setInstructorOffset] = useState(0)
  // Local rather than in the URL: this page holds three tables, so one `?sort=` between
  // them would be owned by whichever card was clicked last -- and the card pages in local
  // state over rows the detail response already carried, so a linked URL would restore an
  // order but not the page it was on. See useCardSort.
  const instructorSort = useCardSort()
  const sessionsRange = useCardRange()
  const pagesRange = useCardRange()
  const rateRange = useCardRange()
  const { data, loading, error } = useApi<StudentDetailResponse>(
    (signal) => getStudent(studentKey, signal),
    [studentKey],
  )

  /**
   * Distinct months the student has a session in, all-time.
   *
   * UTC, like every date here: these are naive wall clocks, and a local read would push a
   * 1st-of-the-month session into the month before.
   */
  const monthsAttended = useMemo(() => {
    const months = new Set<string>()
    for (const report of data?.dwp_reports ?? []) {
      const date = toDate(report.date)
      if (date) months.add(date.toISOString().slice(0, 7))
    }
    return months.size
  }, [data])

  // Named for the record, not the route: a row of tabs and the Back menu are only useful
  // if they say which student. Null while it loads, so the previous title holds rather
  // than flashing the wordmark between two real names.
  useDocumentTitle(error?.status === 404 ? 'Student not found' : data?.student?.student_name ?? null)

  // A mistyped or stale key is an ordinary thing to do, not an error to shout about.
  if (error?.status === 404) {
    return (
      <div className="page">
        <Card title="Student not found" showOverflow={false}>
          <p className="muted">
            No student matches <code>{studentKey}</code>.
          </p>
          <p className="profile-back-block">
            <Link className="button" to="/students">
              Back to all students
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

  if (loading || !data) {
    return (
      <div className="page">
        <p className="state">Loading student…</p>
      </div>
    )
  }

  const { student, stats, dwp_reports } = data

  // One element serves students/:studentKey, so the offset survives a move to another
  // student. Snap back when it no longer addresses a row, rather than resetting in an
  // effect and paying a second render pass -- as the instructor and topic pages do.
  // Filter, then order, then page -- in that order, because paging a list you have not
  // finished narrowing shows the wrong ten rows.
  let instructors = student.instructors
  instructors = withinBound(instructors, 'sessions', sessionsRange.low, sessionsRange.high)
  instructors = withinBound(instructors, 'pages', pagesRange.low, pagesRange.high)
  instructors = withinBound(instructors, 'rate', rateRange.low, rateRange.high)

  if (instructorSort.column) {
    const valueOf = INSTRUCTOR_VALUES[instructorSort.column]
    const sign = instructorSort.direction === 'asc' ? 1 : -1
    instructors = [...instructors].sort((left, right) => {
      if (!valueOf) {
        // The name column, which is the only text one here.
        return left.name.localeCompare(right.name) * sign
      }
      const a = valueOf(left)
      const b = valueOf(right)
      // A missing rate sorts to the bottom whichever way the column runs, rather than
      // reading as the smallest -- as the API does for topics' median.
      if (a === null || b === null) {
        if (a === b) return left.name.localeCompare(right.name)
        return a === null ? 1 : -1
      }
      // Instructor names are unique per student, so this is a total order and the pager
      // cannot repeat or drop a row across a page boundary.
      return (a - b) * sign || left.name.localeCompare(right.name)
    })
  }

  const offset = instructorOffset < instructors.length ? instructorOffset : 0
  const shownInstructors = instructors.slice(offset, offset + INSTRUCTOR_PAGE)

  return (
    <div className="page">
      <div className="page-header">
        <Link className="profile-back" to="/students">
          <ChevronIcon className="profile-back-icon" />
          All students
        </Link>
        <h1>{student.student_name}</h1>
        <p>
          {/* The account is a household -- siblings share it -- which is what tells two
              students with the same name apart. Shown in full here, unlike the list. */}
          <span className="account-id">{student.account_id}</span>
          {student.centers.map((center) => (
            <span key={center.name} className="tag profile-center">
              {center.name} · {formatNumber(center.sessions)}
            </span>
          ))}
        </p>
      </div>

      <div className="tile-row">
        {/* The months read against the count above them: 149 sessions across 12 months.
            The last-session date stays because this is the only place it appears. */}
        <StatTile
          label="Sessions"
          value={formatNumber(student.total_sessions)}
          sub={
            monthsAttended > 0
              ? `${formatNumber(monthsAttended)} month${monthsAttended === 1 ? '' : 's'} · last ${formatDate(student.last_session_date)}`
              : `last on ${formatDate(student.last_session_date)}`
          }
          icon={<StudentsIcon size={22} />}
          wash={1}
        />
        <StatTile
          label="Pages completed"
          value={formatNumber(student.total_pages_completed)}
          icon={<DashboardIcon size={22} />}
          wash={2}
        />
        {/* ..._finished, not ..._completed. The source writes one status per session, so a
            topic mastered is almost never also written Completed -- reading the completed
            count here would understate the student's work roughly twentyfold. */}
        <StatTile
          label="Topics finished"
          value={formatNumber(student.total_unique_topics_finished)}
          sub={`${formatNumber(student.total_unique_topics_mastered)} mastered`}
          icon={<InstructorsIcon size={22} />}
          wash={3}
        />
        <StatTile
          label="Topics on plan"
          value={formatNumber(student.total_topics_on_plan)}
          sub={
            student.total_topic_reassignments > 0
              ? `${formatNumber(student.total_topic_reassignments)} reassignments`
              : undefined
          }
          icon={<DashboardIcon size={22} />}
          wash={4}
        />
      </div>

      {/* The two panel cards share a row: both are a header control over a narrow table,
          and neither filled a full-width one. Their headers wrap rather than crowd --
          see .period in Profile.css, which had to stop keying off the viewport. */}
      <CardRow>
        <AttendancePanel
          studentKey={student.student_key}
          lastSessionDate={student.last_session_date}
        />

        <TopicsCard topics={student.topics} />
      </CardRow>

      <Card title="Instructors" flush>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <ColumnHeader sortable column="name" first="asc" sort={instructorSort}>
                  Instructor
                </ColumnHeader>
                <ColumnHeader
                  sortable
                  column="sessions"
                  className="numeric"
                  sort={instructorSort}
                  filter={
                    <NumberRangeFilter
                      column="sessions"
                      label="sessions"
                      range={sessionsRange}
                    />
                  }
                >
                  Sessions
                </ColumnHeader>
                <ColumnHeader
                  sortable
                  column="pages"
                  className="numeric"
                  sort={instructorSort}
                  filter={
                    <NumberRangeFilter column="pages" label="pages" range={pagesRange} />
                  }
                >
                  Pages completed
                </ColumnHeader>
                <ColumnHeader
                  sortable
                  column="rate"
                  className="numeric"
                  sort={instructorSort}
                  filter={
                    <NumberRangeFilter
                      column="rate"
                      label="pages per session"
                      range={rateRange}
                      // The dashes are not zeroes, and no range matches one.
                      note={`Instructors under ${PAGES_PER_SESSION_MIN} sessions have no rate, so any range here leaves them out.`}
                    />
                  }
                >
                  Pages / session
                </ColumnHeader>
              </tr>
            </thead>
            <tbody>
              {shownInstructors.map((instructor) => (
                <tr key={instructor.name}>
                  <td className="primary-name">
                    {/* The reverse of the instructor profile's roster, which links back
                        here. The name is the key, so no lookup is needed. */}
                    <Link
                      className="row-link"
                      to={`/instructors/${encodeURIComponent(instructor.name)}`}
                    >
                      {instructor.name}
                    </Link>
                  </td>
                  <td className="numeric">{formatNumber(instructor.sessions)}</td>
                  <td className="numeric">{formatNumber(instructor.pages_completed)}</td>
                  {/* Withheld under five sessions: two sessions do not make a rate, and a
                      single heavy day would read as this instructor's normal pace. The
                      zero-denominator guard cannot fire on today's data -- no row with
                      five sessions has none finalized -- but that is a fact about the
                      data, not a rule. */}
                  <td className="numeric">
                    {pagesPerSession(instructor)?.toFixed(1) ?? (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Pages are attributed per instructor per session, so a co-taught session counts
            for each of them. The column does not add up to the tile above, by design. */}
        <p className="muted table-footnote">
          * Co-taught sessions count for each instructor, so these pages sum to more than the
          student&rsquo;s own total. Pages per session is shown from{' '}
          {PAGES_PER_SESSION_MIN} sessions and averages over sessions with a recorded page
          count, so it will not equal pages ÷ sessions where a report was never finalized.
        </p>
        {/* The whole list is already in the detail response, so this pages what is in
            hand. Held back on an empty roster so the card does not answer "No results"
            where it currently shows nothing. */}
        {instructors.length > 0 && (
          <Pager
            page={{
              limit: INSTRUCTOR_PAGE,
              // The filtered total, not the roster's: a pager counting rows the table is
              // not showing would say "1-10 of 23" over three.
              offset,
              total: instructors.length,
              returned: shownInstructors.length,
            }}
            onChange={setInstructorOffset}
          />
        )}
      </Card>

      <SessionHistoryCard reports={dwp_reports} />

      {stats.total_dwp_reports !== dwp_reports.length && (
        <p className="muted">
          Showing {formatNumber(dwp_reports.length)} of {formatNumber(stats.total_dwp_reports)}{' '}
          reports.
        </p>
      )}
    </div>
  )
}
