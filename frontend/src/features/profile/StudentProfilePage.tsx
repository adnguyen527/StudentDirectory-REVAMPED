import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'

import { formatDate, formatNumber, toDate } from '../../api/bson'
import { getStudent } from '../../api/endpoints'
import type { StudentDetailResponse } from '../../api/types'
import { useApi } from '../../hooks/useApi'
import { Card } from '../../shell/Card'
import { ChevronIcon, DashboardIcon, InstructorsIcon, StudentsIcon } from '../../shell/Icons'
import { StatTile } from '../../shell/StatTile'
import { AttendancePanel } from './AttendancePanel'
import { SessionHistoryCard } from './SessionHistoryCard'
import { TopicsCard } from './TopicsCard'
import './Profile.css'

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

      <AttendancePanel
        studentKey={student.student_key}
        lastSessionDate={student.last_session_date}
      />

      <TopicsCard topics={student.topics} />

      <Card title="Instructors" flush>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Instructor</th>
                <th className="numeric">Sessions</th>
                <th className="numeric">Pages completed</th>
              </tr>
            </thead>
            <tbody>
              {student.instructors.map((instructor) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Pages are attributed per instructor per session, so a co-taught session counts
            for each of them. The column does not add up to the tile above, by design. */}
        <p className="muted table-footnote">
          * Co-taught sessions count for each instructor, so these pages sum to more than the
          student's own total.
        </p>
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
