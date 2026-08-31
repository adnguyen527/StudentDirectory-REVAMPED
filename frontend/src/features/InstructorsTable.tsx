import { Link } from 'react-router-dom'

import { formatDate, formatNumber } from '../api/bson'
import type { InstructorListItem } from '../api/types'

interface InstructorsTableProps {
  instructors: InstructorListItem[]
}

/**
 * The instructor list's columns, in one place -- as StudentsTable.
 *
 * Every figure is all-time: the aggregates are batch-built by
 * ingestion/build_instructors.py and carry no period.
 */
export function InstructorsTable({ instructors }: InstructorsTableProps) {
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Instructor</th>
            <th>Center</th>
            <th className="numeric">Sessions</th>
            <th className="numeric">Students</th>
            <th className="numeric">Days</th>
            <th className="numeric">Unfinalized</th>
            <th>Last session</th>
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
