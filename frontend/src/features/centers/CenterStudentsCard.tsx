import { useState } from 'react'

import { formatDate, formatNumber } from '../../api/bson'
import { listStudents } from '../../api/endpoints'
import type { StudentListItem, StudentsResponse } from '../../api/types'
import { useApi } from '../../hooks/useApi'
import { AsyncBoundary } from '../../shell/AsyncBoundary'
import { Card } from '../../shell/Card'
import { Pager } from '../../shell/Pager'
import { Link } from 'react-router-dom'
import './Centers.css'

const ROWS = 10

/**
 * Pages per session, which is stored nowhere and does not need to be.
 *
 * It is two fields divided, recomputed on every render of ten rows. An aggregate field
 * would have to be rebuilt whenever either half moved, to save an arithmetic operation.
 */
function pace(student: StudentListItem) {
  if (!student.total_sessions) return '—'
  return (student.total_pages_completed / student.total_sessions).toFixed(1)
}

/**
 * Who attends these centers, and how they are getting on.
 *
 * All-time, and the title says so: the dashboard's date range governs the sessions card
 * only. These figures come from the built `students` aggregates, which hold totals over a
 * student's whole history and cannot answer a question about a period -- for that the
 * sessions card queries `dwp_reports` directly.
 *
 * Every figure here is exact for the selected centers without any arithmetic, because no
 * student in the data attends two. That is not true of the instructors beside them.
 */
export function CenterStudentsCard({ centers }: { centers: string[] }) {
  const [offset, setOffset] = useState(0)
  const centerKey = centers.join('|')

  const { data, loading, error } = useApi<StudentsResponse>(
    (signal) => listStudents({ limit: ROWS, offset, centers }, signal),
    [centerKey, offset],
  )

  const [mark, setMark] = useState(centerKey)
  if (mark !== centerKey) {
    setMark(centerKey)
    setOffset(0)
  }

  const page = data?.page

  return (
    <Card title="Students · all-time" flush>
      <AsyncBoundary
        loading={loading}
        error={error}
        empty={data?.students.length === 0}
        emptyMessage="No students at these centers."
      >
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Student</th>
                <th className="numeric">Sessions</th>
                <th className="numeric">Pages</th>
                <th className="numeric">Pages/session</th>
                <th className="numeric">Finished</th>
                <th className="numeric">On plan</th>
                <th>Last session</th>
              </tr>
            </thead>
            <tbody>
              {data?.students.map((student) => (
                <tr key={student.student_key}>
                  <td className="primary-name">
                    <Link
                      className="row-link"
                      to={`/students/${encodeURIComponent(student.student_key)}`}
                    >
                      {student.student_name}
                    </Link>
                    {/* The center is a row detail here rather than a column: with one
                        center picked it is the same word ten times over. */}
                    <div className="row-sub">{student.centers[0]?.name}</div>
                  </td>
                  <td className="numeric">{formatNumber(student.total_sessions)}</td>
                  <td className="numeric">{formatNumber(student.total_pages_completed)}</td>
                  <td className="numeric">{pace(student)}</td>
                  {/* ⚠️ finished, not completed. The source writes one status per session,
                      so a mastered topic is almost never also written Completed -- reading
                      the completed count understates a student's work about twentyfold. */}
                  <td className="numeric">
                    {formatNumber(student.total_unique_topics_finished)}
                  </td>
                  <td className="numeric">{formatNumber(student.total_topics_on_plan)}</td>
                  <td>{formatDate(student.last_session_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AsyncBoundary>
      {page && !error && <Pager page={page} onChange={setOffset} />}
    </Card>
  )
}
