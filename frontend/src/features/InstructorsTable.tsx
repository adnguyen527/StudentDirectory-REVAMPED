import { Link } from 'react-router-dom'

import { formatDate, formatNumber } from '../api/bson'
import type { InstructorListItem } from '../api/types'
import { DateRangeFilter } from './DateRangeFilter'
import { NumberRangeFilter } from './NumberRangeFilter'
import { ColumnHeader } from './SortHeader'

interface InstructorsTableProps {
  instructors: InstructorListItem[]
  sortable?: boolean
}

/**
 * The instructor list's columns, in one place -- as StudentsTable.
 *
 * Every figure is all-time: the aggregates are batch-built by
 * ingestion/build_instructors.py and carry no period.
 */
export function InstructorsTable({ instructors, sortable }: InstructorsTableProps) {
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          {/* Students and Days sort from arrays counted at query time rather than
              stored fields -- Instructor._page. They behave like any other column here;
              the difference is only that they cannot ride an index. */}
          <tr>
            <ColumnHeader sortable={sortable} column="name" first="asc">
              Instructor
            </ColumnHeader>
            <ColumnHeader sortable={sortable}>Center</ColumnHeader>
            <ColumnHeader
              sortable={sortable}
              column="sessions"
              className="numeric"
              filter={<NumberRangeFilter column="sessions" label="sessions" />}
            >
              Sessions
            </ColumnHeader>
            <ColumnHeader sortable={sortable} column="students" className="numeric">
              Students
            </ColumnHeader>
            <ColumnHeader sortable={sortable} column="days" className="numeric">
              Days
            </ColumnHeader>
            <ColumnHeader
              sortable={sortable}
              column="unfinalized"
              className="numeric"
              filter={<NumberRangeFilter column="unfinalized" label="unfinalized" />}
            >
              Unfinalized
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
          {instructors.map((instructor) => (
            <tr key={instructor.instructor_name}>
              <td className="primary-name">
                <Link
                  className="row-link"
                  to={`/instructors/${encodeURIComponent(instructor.instructor_name)}`}
                >
                  {instructor.instructor_name}
                </Link>
              </td>
              <td>
                {instructor.centers[0] ? (
                  <span className="tag">{instructor.centers[0].name}</span>
                ) : (
                  <span className="muted">—</span>
                )}
                {/* Most teach at one center; the count says so without listing them. */}
                {instructor.centers.length > 1 && (
                  <span className="muted"> +{instructor.centers.length - 1}</span>
                )}
              </td>
              <td className="numeric">{formatNumber(instructor.total_sessions_taught)}</td>
              <td className="numeric">{formatNumber(instructor.unique_students)}</td>
              <td className="numeric">{formatNumber(instructor.total_days_taught)}</td>
              {/* Reports never completed. Called out rather than left as a plain number:
                  it is the one column here that is a to-do rather than a statistic. */}
              <td className="numeric">
                {instructor.unfinalized_sessions > 0 ? (
                  <span className="tag tag-warn">
                    {formatNumber(instructor.unfinalized_sessions)}
                  </span>
                ) : (
                  <span className="muted">0</span>
                )}
              </td>
              <td className="muted">{formatDate(instructor.last_session_date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
