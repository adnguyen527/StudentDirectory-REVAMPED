// libraries & hooks
import { useSearchParams } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
// apis
import { formatNumber } from '../api/bson'
import { PAGE_SIZE, listStudents } from '../api/endpoints'
import type { StudentsResponse } from '../api/types'
// components
import { AsyncBoundary } from '../shell/AsyncBoundary'
import { Card } from '../shell/Card'
import { Pager } from '../shell/Pager'
import { CenterFilter } from './CenterFilter'
import { FilterBar } from './FilterBar'
import { ListFilter } from './ListFilter'
import { StudentsTable } from './StudentsTable'
// utils
import { nounFor, orderPhrase, type OrderPhrase } from './orderPhrase'
import { rangeKey, rangeParams, type RangeColumns } from './ranges'
import { useDocumentTitle } from '../shell/useDocumentTitle'

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

  /**
   * What the table is, in words -- the count and the order it is in.
   *
   * ⚠️ Leads with the count rather than the noun alone. "Students" here would name the same
   * thing the <h1> above already names, which reads as a repeat on screen and makes
   * getByRole('heading', { name: 'Students' }) ambiguous in a test.
   */
  const summary = page
    ? `${formatNumber(page.total)} ${query ? 'matching ' : ''}${nounFor(page.total, 'student')}, ` +
      `${orderPhrase(ORDER, 'sorted by name', sort, direction)}`
    : 'Sorted by name'

  return (
    <div className="page">
      <div className="page-header">
        <h1>Students</h1>
      </div>

      {/* Above the table rather than in its card header, because it scopes the whole page
          -- see FilterBar. */}
      <FilterBar>
        <ListFilter placeholder="Search students by name" />
        <CenterFilter />
      </FilterBar>

      {/* The count and the order name the *table*, not the page, so they sit on the
          table's card rather than under the <h1>. Leading with the count also keeps this
          heading from repeating the page's own name back at it. */}
      <Card title={summary} flush>
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
