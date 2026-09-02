import { useSearchParams } from 'react-router-dom'

import { formatNumber } from '../api/bson'
import { PAGE_SIZE, listStudents } from '../api/endpoints'
import type { StudentsResponse } from '../api/types'
import { useApi } from '../hooks/useApi'
import { AsyncBoundary } from '../shell/AsyncBoundary'
import { Card } from '../shell/Card'
import { Pager } from '../shell/Pager'
import { CenterFilter } from './CenterFilter'
import { ListFilter } from './ListFilter'
import { StudentsTable } from './StudentsTable'

/**
 * The full student list.
 *
 * Both the filter and the page live in the URL, so a search result is linkable and the
 * browser's Back button steps through pages instead of leaving the app.
 */
export function StudentsPage() {
  const [params, setParams] = useSearchParams()
  const query = params.get('query') ?? ''
  const offset = Math.max(0, Number(params.get('offset') ?? 0) || 0)
  // Repeatable: several ticked centers are a union. Joined for the dep array because an
  // array literal is a new reference every render.
  const centers = params.getAll('center')
  const centerKey = centers.join('|')

  const { data, loading, error } = useApi<StudentsResponse>(
    (signal) => listStudents({ limit: PAGE_SIZE, offset, query, centers }, signal),
    [query, offset, centerKey],
  )

  function goToOffset(next: number) {
    const updated = new URLSearchParams(params)
    if (next > 0) updated.set('offset', String(next))
    else updated.delete('offset')
    setParams(updated)
  }

  function clearFilter() {
    // The offset goes with it -- page 3 of the filtered list is not page 3 of the whole.
    setParams(new URLSearchParams())
  }

  const page = data?.page

  return (
    <div className="page">
      <div className="page-header">
        <h1>Students</h1>
        <p>
          {page
            ? `${formatNumber(page.total)} ${query ? 'matching' : 'in total'}, sorted by name.`
            : 'Sorted by name.'}
        </p>
      </div>

      {/* No title: the <h1> above already says Students. */}
      <Card
        lead={
          <div className="list-controls">
            <ListFilter placeholder="Search students by name" />
            <CenterFilter />
          </div>
        }
        flush
        controls={
          query ? (
            <button type="button" className="button" onClick={clearFilter}>
              Clear filter
            </button>
          ) : undefined
        }
      >
        <AsyncBoundary
          loading={loading}
          error={error}
          empty={data?.students.length === 0}
          emptyMessage={
            query ? `No students match “${query}”.` : 'No students in the database yet.'
          }
        >
          <StudentsTable students={data?.students ?? []} />
        </AsyncBoundary>

        {page && !error && <Pager page={page} onChange={goToOffset} />}
      </Card>
    </div>
  )
}
