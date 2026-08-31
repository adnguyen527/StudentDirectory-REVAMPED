import { Link } from 'react-router-dom'

import { formatDate, formatNumber } from '../api/bson'
import type { StudentListItem } from '../api/types'

interface StudentsTableProps {
  students: StudentListItem[]
}

/**
 * The student list's columns, in one place.
 *
 * The dashboard card and the full list page both render this, so the two cannot end up
 * showing different columns for the same rows.
 *
 * Every figure here is all-time -- the aggregates are batch-built by
 * ingestion/build_students.py and carry no period. A date range needs the attendance
 * route, which is the session-count panel, not this table.
 */
export function StudentsTable({ students }: StudentsTableProps) {
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Student</th>
            <th>Account</th>
            <th>Center</th>
            <th className="numeric">Sessions</th>
            <th className="numeric">Topics finished</th>
            <th className="numeric">On plan</th>
            <th>Last session</th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => (
            <tr key={student.student_key}>
              <td className="primary-name">
                <Link className="row-link" to={`/students/${encodeURIComponent(student.student_key)}`}>
                  {student.student_name}
                </Link>
              </td>
              {/* A household, not a person -- siblings share it, so it is what tells two
                  students with the same name apart. Truncated because it is an identifier
                  to compare, not to read; the full value is on hover and in the title. */}
              <td className="muted account-id" title={student.account_id}>
                {student.account_id.slice(0, 8)}
              </td>
              <td>
                {student.centers[0] ? (
                  <span className="tag">{student.centers[0].name}</span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td className="numeric">{formatNumber(student.total_sessions)}</td>
              {/* ..._finished, not ..._completed: mastered implies completed, and the
                  source writes one status per session, so the completed count alone
                  misses every topic that went straight to mastered. */}
              <td className="numeric">{formatNumber(student.total_unique_topics_finished)}</td>
              <td className="numeric">{formatNumber(student.total_topics_on_plan)}</td>
              <td className="muted">{formatDate(student.last_session_date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
