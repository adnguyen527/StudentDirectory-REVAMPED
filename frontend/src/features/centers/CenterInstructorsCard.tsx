import { useState } from 'react'
// libraries & hooks
import { Link } from 'react-router-dom'
import { useApi } from '../../hooks/useApi'
// apis
import { formatDate, formatNumber } from '../../api/bson'
import { listInstructors } from '../../api/endpoints'
import type { InstructorListItem, InstructorsResponse } from '../../api/types'
// components
import { AsyncBoundary } from '../../shell/AsyncBoundary'
import { Card } from '../../shell/Card'
import { Pager } from '../../shell/Pager'
// styles
import './Centers.css'

const ROWS = 10

/**
 * Sessions this instructor taught at the centers currently selected.
 *
 * ⚠️ `total_sessions_taught` is all-time across every center they work at, so for the 11
 * of 103 who work at more than one it answers a wider question than the page is asking.
 * The built aggregate carries a per-center breakdown -- `centers[]` is `{name, sessions}`
 * -- so the selected names are summed out of it and the figure is exact.
 *
 * With nothing selected the page is asking about every center, and the total is the answer.
 */
function centerSessions(instructor: InstructorListItem, centers: string[]) {
  if (centers.length === 0) return instructor.total_sessions_taught
  return instructor.centers
    .filter((center) => centers.includes(center.name))
    .reduce((sum, center) => sum + center.sessions, 0)
}

/**
 * Who teaches at these centers.
 *
 * All-time, as the students card is, and for the same reason: the dashboard's date range
 * governs the sessions card alone.
 *
 * ⚠️ **Two of these columns cannot be narrowed to a center and are labelled as such.**
 * `centers[]` records sessions per center but not pages, so Pages and Pages/session are
 * all-time across everywhere the instructor works. For the 11 who work at two centers,
 * those two columns describe more work than happened at the selected ones. Showing them
 * unlabelled would be the wrong kind of wrong -- the fix is a `pages_completed` on
 * `centers[]` in build_instructors.py, which needs a rebuild and is on the TODO.
 */
export function CenterInstructorsCard({ centers }: { centers: string[] }) {
  const [offset, setOffset] = useState(0)
  const centerKey = centers.join('|')

  const { data, loading, error } = useApi<InstructorsResponse>(
    (signal) => listInstructors({ limit: ROWS, offset, centers }, signal),
    [centerKey, offset],
  )

  const [mark, setMark] = useState(centerKey)
  if (mark !== centerKey) {
    setMark(centerKey)
    setOffset(0)
  }

  const page = data?.page
  // Only worth a footnote when a narrowing is actually in force and somebody is affected.
  const spansCenters = Boolean(
    centers.length > 0 && data?.instructors.some((i) => i.centers.length > 1),
  )

  return (
    <Card title="Instructors · all-time" flush>
      <AsyncBoundary
        loading={loading}
        error={error}
        empty={data?.instructors.length === 0}
        emptyMessage="No instructors at these centers."
      >
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Instructor</th>
                <th className="numeric">Sessions</th>
                <th className="numeric">Students</th>
                <th className="numeric">Days</th>
                <th className="numeric" title="Across every center this instructor works at">
                  Pages
                </th>
                <th className="numeric" title="Across every center this instructor works at">
                  Pages/session
                </th>
                <th>Last session</th>
              </tr>
            </thead>
            <tbody>
              {data?.instructors.map((instructor) => (
                <tr key={instructor.instructor_name}>
                  <td className="primary-name">
                    <Link
                      className="row-link"
                      to={`/instructors/${encodeURIComponent(instructor.instructor_name)}`}
                    >
                      {instructor.instructor_name}
                    </Link>
                    <div className="row-sub">
                      {instructor.centers.map((center) => center.name).join(', ')}
                    </div>
                  </td>
                  <td className="numeric">
                    {formatNumber(centerSessions(instructor, centers))}
                  </td>
                  <td className="numeric">{formatNumber(instructor.unique_students)}</td>
                  <td className="numeric">{formatNumber(instructor.total_days_taught)}</td>
                  <td className="numeric">
                    {formatNumber(instructor.total_pages_completed)}
                  </td>
                  <td className="numeric">
                    {/* Both halves all-time, so the two agree with each other even though
                        neither agrees with the Sessions column beside them. */}
                    {instructor.total_sessions_taught
                      ? (
                          instructor.total_pages_completed / instructor.total_sessions_taught
                        ).toFixed(1)
                      : '—'}
                  </td>
                  <td>{formatDate(instructor.last_session_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {spansCenters && (
          <p className="table-footnote">
            Sessions counts the selected centers. Pages and Pages/session are all-time
            across every center an instructor works at.
          </p>
        )}
      </AsyncBoundary>
      {page && !error && <Pager page={page} onChange={setOffset} />}
    </Card>
  )
}
