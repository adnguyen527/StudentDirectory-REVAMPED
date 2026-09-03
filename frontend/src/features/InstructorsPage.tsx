import { useSearchParams } from 'react-router-dom'

import { formatNumber } from '../api/bson'
import { PAGE_SIZE, listInstructors } from '../api/endpoints'
import type { InstructorsResponse } from '../api/types'
import { useApi } from '../hooks/useApi'
import { AsyncBoundary } from '../shell/AsyncBoundary'
import { Card } from '../shell/Card'
import { Pager } from '../shell/Pager'
import { InstructorsTable } from './InstructorsTable'
import { CenterFilter } from './CenterFilter'
import { ClearFilters } from './ClearFilters'
import { ListFilter } from './ListFilter'
import { orderPhrase, type OrderPhrase } from './orderPhrase'
import { rangeKey, rangeParams, type RangeColumns } from './ranges'

// As StudentsPage: `first` has to match what InstructorsTable passes the header.
// As StudentsPage -- mirrors models/instructor.py's FILTERABLE. Students and Days sort
// but do not filter: they are counted from arrays at query time, so a bound on them
// cannot be matched before the pipeline computes them.
const FILTER_COLUMNS: RangeColumns = {
  sessions: 'number',
  unfinalized: 'number',
  last_session: 'date',
}

const ORDER: Record<string, OrderPhrase> = {
  name: { first: 'asc', asc: 'sorted by name', desc: 'sorted by name, Z-A' },
  sessions: { first: 'desc', desc: 'most sessions first', asc: 'fewest sessions first' },
  students: { first: 'desc', desc: 'most students first', asc: 'fewest students first' },
  days: { first: 'desc', desc: 'most days taught first', asc: 'fewest days taught first' },
  unfinalized: {
    first: 'desc',
    desc: 'most unfinalized first',
    asc: 'fewest unfinalized first',
  },
  last_session: { first: 'desc', desc: 'most recent session first', asc: 'longest ago first' },
}

/**
 * The full instructor list.
 *
 * 103 documents fit in three pages and would not need paging at all, but it shares the
 * students list's shape so both read the same way and the roster can grow without this
 * changing. Filter and page live in the URL for the same reason as there.
 */
export function InstructorsPage() {
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

  const { data, loading, error } = useApi<InstructorsResponse>(
    (signal) =>
      listInstructors(
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
        <h1>Instructors</h1>
        <p>
          {page
            ? `${formatNumber(page.total)} ${query ? 'matching' : 'in total'}, ` +
              `${orderPhrase(ORDER, 'sorted by name', sort, direction)}.`
            : 'Sorted by name.'}
        </p>
      </div>

      {/* No title: the <h1> above already says Instructors. */}
      <Card
        lead={
          <div className="list-controls">
            <ListFilter placeholder="Search instructors by name" />
            <CenterFilter />
          </div>
        }
        flush
        controls={<ClearFilters />}
      >
        <AsyncBoundary
          loading={loading}
          error={error}
          empty={data?.instructors.length === 0}
          emptyMessage={
            query ? `No instructors match “${query}”.` : 'No instructors in the database yet.'
          }
        >
          <InstructorsTable
            instructors={data?.instructors ?? []}
            sortable
          />
        </AsyncBoundary>

        {page && !error && <Pager page={page} onChange={goToOffset} />}
      </Card>
    </div>
  )
}
