import { useSearchParams } from 'react-router-dom'

import { formatNumber } from '../api/bson'
import { PAGE_SIZE, listStudents } from '../api/endpoints'
import type { StudentsResponse } from '../api/types'
import { useApi } from '../hooks/useApi'
import { AsyncBoundary } from '../shell/AsyncBoundary'
import { Card } from '../shell/Card'
import { Pager } from '../shell/Pager'
import { useDocumentTitle } from '../shell/useDocumentTitle'
import { CenterFilter } from './CenterFilter'
import { ClearFilters } from './ClearFilters'
import { ListFilter } from './ListFilter'
import { orderPhrase, type OrderPhrase } from './orderPhrase'
import { rangeKey, rangeParams, type RangeColumns } from './ranges'
import { StudentsTable } from './StudentsTable'

// Each sortable column said in words, for the line under the title. `first` has to
// match what StudentsTable passes the same column's header.
// The columns this list can be bounded by, and the kind of bound each takes -- the same
// declaration models/student.py makes as FILTERABLE, and the URL's names are the API's.
const FILTER_COLUMNS: RangeColumns = {
  sessions: 'number',
  finished: 'number',
  on_plan: 'number',
  last_session: 'date',
}

const ORDER: Record<string, OrderPhrase> = {
  name: { first: 'asc', asc: 'sorted by name', desc: 'sorted by name, Z-A' },
  sessions: { first: 'desc', desc: 'most sessions first', asc: 'fewest sessions first' },
  finished: {
    first: 'desc',
    desc: 'most topics finished first',
    asc: 'fewest topics finished first',
  },
  on_plan: {
    first: 'desc',
    desc: 'most topics on plan first',
    asc: 'fewest topics on plan first',
  },
  last_session: { first: 'desc', desc: 'most recent session first', asc: 'longest ago first' },
}

/**
 * The full student list.
 *
 * Both the filter and the page live in the URL, so a search result is linkable and the
 * browser's Back button steps through pages instead of leaving the app.
 */
export function StudentsPage() {
  useDocumentTitle('Students')
  const [params, setParams] = useSearchParams()
  const query = params.get('query') ?? ''
  const offset = Math.max(0, Number(params.get('offset') ?? 0) || 0)
  // Repeatable: several ticked centers are a union. Joined for the dep array because an
  // array literal is a new reference every render.
  const centers = params.getAll('center')
  const centerKey = centers.join('|')
  // Passed straight through: the URL's spelling is the API's -- routes/sorting.py.
  const sort = params.get('sort') ?? undefined
  const direction = (params.get('direction') as 'asc' | 'desc' | null) ?? undefined
  // Every column bound currently set, and a stable key for the dependency array.
  const ranges = rangeParams(params, FILTER_COLUMNS)
  const rangesKey = rangeKey(ranges)

  const { data, loading, error } = useApi<StudentsResponse>(
    (signal) =>
      listStudents(
        { limit: PAGE_SIZE, offset, query, centers, sort, direction, ranges },
        signal,
      ),
    [query, offset, centerKey, sort, direction, rangesKey],
  )

  function goToOffset(next: number) {
    const updated = new URLSearchParams(params)
    if (next > 0) updated.set('offset', String(next))
    else updated.delete('offset')
    setParams(updated)
  }

  const page = data?.page

  return (
    <div className="page">
      <div className="page-header">
        <h1>Students</h1>
        <p>
          {page
            ? `${formatNumber(page.total)} ${query ? 'matching' : 'in total'}, ` +
              `${orderPhrase(ORDER, 'sorted by name', sort, direction)}.`
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
        controls={<ClearFilters />}
      >
        <AsyncBoundary
          loading={loading}
          error={error}
          empty={data?.students.length === 0}
          emptyMessage={
            query ? `No students match “${query}”.` : 'No students in the database yet.'
          }
        >
          <StudentsTable
            students={data?.students ?? []}
            sortable
          />
        </AsyncBoundary>

        {page && !error && <Pager page={page} onChange={goToOffset} />}
      </Card>
    </div>
  )
}
