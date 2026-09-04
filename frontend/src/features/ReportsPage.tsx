import { useSearchParams } from 'react-router-dom'

import { formatNumber } from '../api/bson'
import { PAGE_SIZE, listReports } from '../api/endpoints'
import type { ReportsResponse } from '../api/types'
import { useApi } from '../hooks/useApi'
import { AsyncBoundary } from '../shell/AsyncBoundary'
import { Card } from '../shell/Card'
import { Pager } from '../shell/Pager'
import { useDocumentTitle } from '../shell/useDocumentTitle'
import { CenterFilter } from './CenterFilter'
import { ClearFilters } from './ClearFilters'
import { DateRangeFilter } from './DateRangeFilter'
import { ListFilter } from './ListFilter'
import { orderPhrase, type OrderPhrase } from './orderPhrase'
import { rangeKey, rangeParams, type RangeColumns } from './ranges'
import { ReportsTable } from './ReportsTable'

// The columns this list can be bounded by -- the same declaration models/dwp_report.py
// makes as FILTERABLE, and the URL's names are the API's.
const FILTER_COLUMNS: RangeColumns = {
  date: 'date',
}

// Each sortable column said in words, for the line under the title. `first` has to match
// what ReportsTable passes the same column's header.
const ORDER: Record<string, OrderPhrase> = {
  date: { first: 'desc', desc: 'newest first', asc: 'oldest first' },
  student: {
    first: 'asc',
    asc: 'sorted by student',
    desc: 'sorted by student, Z-A',
  },
}

/**
 * Every session report, 29,382 of them.
 *
 * The one list here whose rows are raw source records rather than a built rollup, which is
 * what makes it worth having: students, instructors and topics all answer "how has this
 * gone over time", and none of them answers "what happened at Southlake last Tuesday".
 *
 * Unlike the other three, the filters sit together in the card header rather than in the
 * column headers. The distinction that puts them there is what you arrive knowing: a
 * student list is scanned and then narrowed by a column you are already looking at, while
 * a session list is almost always entered with a period and a center already in mind, and
 * a filter you have to go hunting through a header row for is the wrong shape for that.
 */
export function ReportsPage() {
  useDocumentTitle('Reports')
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

  const { data, loading, error } = useApi<ReportsResponse>(
    (signal) =>
      listReports({ limit: PAGE_SIZE, offset, query, centers, sort, direction, ranges }, signal),
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
        <h1>Reports</h1>
        <p>
          {page
            ? `${formatNumber(page.total)} ${query ? 'matching' : 'in total'}, ` +
              `${orderPhrase(ORDER, 'newest first', sort, direction)}.`
            : 'Newest first.'}
        </p>
      </div>

      {/* No title: the <h1> above already says Reports. The placeholder says what the box
          matches -- the student, not the instructor, who is a column you read rather than
          the thing you arrive looking for. */}
      <Card
        lead={
          <div className="list-controls">
            <ListFilter placeholder="Search reports by student name" />
            <CenterFilter />
            <DateRangeFilter column="date" label="session date" standalone />
          </div>
        }
        flush
        controls={<ClearFilters />}
      >
        <AsyncBoundary
          loading={loading}
          error={error}
          empty={data?.reports.length === 0}
          emptyMessage={
            query ? `No reports match “${query}”.` : 'No reports match these filters.'
          }
        >
          <ReportsTable reports={data?.reports ?? []} sortable />
        </AsyncBoundary>

        {page && !error && <Pager page={page} onChange={goToOffset} />}
      </Card>
    </div>
  )
}
