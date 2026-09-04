import { Link } from 'react-router-dom'

import { formatDate, formatNumber } from '../api/bson'
import type { StudentListItem } from '../api/types'
import { DateRangeFilter } from './DateRangeFilter'
import { NumberRangeFilter } from './NumberRangeFilter'
import { ColumnHeader } from './SortHeader'

interface StudentsTableProps {
  students: StudentListItem[]
  /**
   * Whether the headings sort. Off by default because the home page renders this table
   * as a fixed top-five card, where reordering five rows is not a question anyone has.
   */
  sortable?: boolean
}

/**
 * The student list's columns, in one place.
 *
 * The home page's card and the full list page both render this, so the two cannot end up
 * showing different columns for the same rows.
 *
 * Every figure here is all-time -- the aggregates are batch-built by
 * ingestion/build_students.py and carry no period. A date range needs the attendance
 * route, which is the session-count panel, not this table.
 */
export function StudentsTable({ students, sortable }: StudentsTableProps) {
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          {/* Center carries no `column` either: a student's centers are an array, so
              there is no one value to order the row by. It filters instead. */}
          <tr>
            <ColumnHeader sortable={sortable} column="name" first="asc">
              Student
            </ColumnHeader>
            {/* Neither sorts nor filters. The account id is an opaque handle shown
                truncated, so an order over it means nothing to read, and the question
                it does answer -- who else is on this account -- is ?account_id=. */}
            <ColumnHeader sortable={sortable}>Account</ColumnHeader>
            <ColumnHeader sortable={sortable}>Center</ColumnHeader>
            <ColumnHeader
              sortable={sortable}
              column="sessions"
              className="numeric"
              filter={<NumberRangeFilter column="sessions" label="sessions" />}
            >
              Sessions
            </ColumnHeader>
            <ColumnHeader
              sortable={sortable}
              column="finished"
              className="numeric"
              filter={<NumberRangeFilter column="finished" label="topics finished" />}
            >
              Topics finished
            </ColumnHeader>
            <ColumnHeader
              sortable={sortable}
              column="on_plan"
              className="numeric"
              filter={<NumberRangeFilter column="on_plan" label="topics on plan" />}
            >
              On plan
            </ColumnHeader>
            <ColumnHeader
              sortable={sortable}
              column="last_session"
              filter={<DateRangeFilter column="last_session" label="last session" />}
            >
              Last session
            </ColumnHeader>
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
