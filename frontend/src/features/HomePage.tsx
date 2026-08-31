import { formatNumber } from '../api/bson'
import { getMetrics, listStudents } from '../api/endpoints'
import type { Metrics, StudentsResponse } from '../api/types'
import { useApi } from '../hooks/useApi'
import { AsyncBoundary } from '../shell/AsyncBoundary'
import { Card } from '../shell/Card'
import { DashboardIcon, InstructorsIcon, StudentsIcon } from '../shell/Icons'
import { StatTile } from '../shell/StatTile'
import { StudentsTable } from './StudentsTable'

const PREVIEW_ROWS = 8

/**
 * The overview screen.
 *
 * The tile row is hard-coded for now. The README's target is a row assembled by pinning
 * rather than fixed, so these four are a placeholder for that mechanism -- StatTile and
 * Card's controls slot are the parts that will survive it.
 */
export function HomePage() {
  const metrics = useApi<Metrics>((signal) => getMetrics(signal), [])
  const students = useApi<StudentsResponse>(
    (signal) => listStudents({ limit: PREVIEW_ROWS }, signal),
    [],
  )

  const m = metrics.data

  return (
    <div className="page">
      <div className="page-header">
        <h1>Home</h1>
        <p>All-time totals across the imported reports.</p>
      </div>

      {/* The tiles carry their own error rather than blanking: a failed /api/metrics is
          the first place a missing API key shows up, and it should say so. */}
      {metrics.error ? (
        <div className="state-error" role="alert">
          <strong>
            {metrics.error.status ? `Error ${metrics.error.status}` : 'Cannot reach the API'}
          </strong>
          {metrics.error.displayMessage}
        </div>
      ) : (
        <div className="tile-row" data-testid="tile-row">
          <StatTile
            label="Students"
            value={formatNumber(m?.total_students)}
            icon={<StudentsIcon size={22} />}
            wash={1}
            loading={metrics.loading}
          />
          <StatTile
            label="Instructors"
            value={formatNumber(m?.total_instructors)}
            icon={<InstructorsIcon size={22} />}
            wash={2}
            loading={metrics.loading}
          />
          <StatTile
            label="DWP reports"
            value={formatNumber(m?.total_dwp_reports)}
            sub={`${m?.avg_dwp_per_student ?? 0} per student on average`}
            icon={<DashboardIcon size={22} />}
            wash={3}
            loading={metrics.loading}
          />
          <StatTile
            label="Attendance records"
            value={formatNumber(m?.total_attendance_records)}
            sub={`${m?.avg_attendance_per_student ?? 0} per student on average`}
            icon={<DashboardIcon size={22} />}
            wash={4}
            loading={metrics.loading}
          />
        </div>
      )}

      {/* "First" and not "recent": /api/students sorts by name, so this is the top of the
          alphabet, not the latest activity. Calling it recent would be a lie the data
          cannot back. */}
      <Card title={`Students · first ${PREVIEW_ROWS} A–Z`} flush>
        <AsyncBoundary
          loading={students.loading}
          error={students.error}
          empty={students.data?.students.length === 0}
          emptyMessage="No students in the database yet — run the ingestion scripts."
        >
          <StudentsTable students={students.data?.students ?? []} />
        </AsyncBoundary>
      </Card>
    </div>
  )
}
