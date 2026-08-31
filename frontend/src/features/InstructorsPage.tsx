import { Card } from '../shell/Card'

/**
 * Placeholder, so the nav item does not dead-end.
 *
 * The plumbing is already here -- `listInstructors` and `InstructorListItem` are written
 * and the API returns the same envelope the students list uses -- so this becomes a real
 * table by reusing StudentsTable's shape. It is left out of this pass deliberately.
 */
export function InstructorsPage() {
  return (
    <div className="page">
      <div className="page-header">
        <h1>Instructors</h1>
        <p>Not built yet.</p>
      </div>

      <Card title="Next up" showOverflow={false}>
        <p className="muted">
          <code>/api/instructors</code> already serves sessions taught, unique students,
          centers and unfinalized sessions in the same paged envelope the students list
          uses, and the typed client for it is in place.
        </p>
        <p className="muted" style={{ marginTop: 'var(--space-3)' }}>
          What it is waiting on is the most-taught topics field — the collection carries no
          topic data today, so an instructor profile would be missing the part a manager
          would actually come here for.
        </p>
      </Card>
    </div>
  )
}
