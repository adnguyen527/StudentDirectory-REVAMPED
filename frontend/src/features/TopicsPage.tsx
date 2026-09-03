import { useSearchParams } from 'react-router-dom'

import { formatNumber } from '../api/bson'
import { PAGE_SIZE, listTopics } from '../api/endpoints'
import type { TopicsResponse } from '../api/types'
import { useApi } from '../hooks/useApi'
import { AsyncBoundary } from '../shell/AsyncBoundary'
import { Card } from '../shell/Card'
import { Pager } from '../shell/Pager'
import { ClearFilters } from './ClearFilters'
import { ListFilter } from './ListFilter'
import { orderPhrase, type OrderPhrase } from './orderPhrase'
import { rangeKey, rangeParams, type RangeColumns } from './ranges'
import { TopicsTable } from './TopicsTable'

// As StudentsPage. The resting order here is most-worked rather than by name, which is
// why the third click on a header has to be able to get back to it.
// As StudentsPage -- mirrors models/topic.py's FILTERABLE.
const FILTER_COLUMNS: RangeColumns = {
  sessions: 'number',
  students: 'number',
  finished: 'number',
  on_plan: 'number',
  removed: 'number',
  median: 'number',
  reassigned: 'number',
}

const ORDER: Record<string, OrderPhrase> = {
  name: { first: 'asc', asc: 'sorted by name', desc: 'sorted by name, Z-A' },
  sessions: { first: 'desc', desc: 'most worked first', asc: 'least worked first' },
  students: { first: 'desc', desc: 'most students first', asc: 'fewest students first' },
  finished: { first: 'desc', desc: 'most finished first', asc: 'fewest finished first' },
  on_plan: { first: 'desc', desc: 'most on plan first', asc: 'fewest on plan first' },
  removed: { first: 'desc', desc: 'most removed first', asc: 'fewest removed first' },
  // Topics nobody has finished have no median at all, and the API keeps them at the
  // bottom either way -- so neither phrase should suggest they are the extreme.
  median: {
    first: 'desc',
    desc: 'slowest to finish first',
    asc: 'quickest to finish first',
  },
  reassigned: { first: 'desc', desc: 'most reassigned first', asc: 'fewest reassigned first' },
}

/**
 * The full topic list, 771 of them.
 *
 * It carries its own filter bar rather than leaning on the top-bar search, which answers
 * students and instructors -- 771 topics would bury both in that dropdown, and a list this
 * long is filtered while you read it rather than jumped into from elsewhere.
 *
 * The filter runs through `?query=` on the list route, which matches the current name, the
 * names a topic no longer goes by, and the topic id. No minimum length: that floor belongs
 * to /topics/search, which serves a typeahead this page does not use.
 */
export function TopicsPage() {
  const [params, setParams] = useSearchParams()
  const query = params.get('query') ?? ''
  const offset = Math.max(0, Number(params.get('offset') ?? 0) || 0)
  // Passed straight through: the URL's spelling is the API's -- routes/sorting.py.
  const sort = params.get('sort') ?? undefined
  const direction = (params.get('direction') as 'asc' | 'desc' | null) ?? undefined
  // Every column bound currently set, and a stable key for the dependency array.
  const ranges = rangeParams(params, FILTER_COLUMNS)
  const rangesKey = rangeKey(ranges)

  const { data, loading, error } = useApi<TopicsResponse>(
    (signal) =>
      listTopics({ limit: PAGE_SIZE, offset, query, sort, direction, ranges }, signal),
    [query, offset, sort, direction, rangesKey],
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
        <h1>Topics</h1>
        <p>
          {page
            ? `${formatNumber(page.total)} ${query ? 'matching' : 'in total'}, ` +
              `${orderPhrase(ORDER, 'most worked first', sort, direction)}.`
            : 'Most worked first.'}
        </p>
      </div>

      {/* No title: the <h1> above already says Topics. The placeholder says what the
          box matches -- the id is a real handle, and the only thing separating two topics
          that share a name. */}
      <Card
        flush
        lead={<ListFilter placeholder="Search topics by name or id" />}
        controls={<ClearFilters />}
      >
        <AsyncBoundary
          loading={loading}
          error={error}
          empty={data?.topics.length === 0}
          emptyMessage={
            query ? `No topics match “${query}”.` : 'No topics in the database yet.'
          }
        >
          <TopicsTable topics={data?.topics ?? []} sortable />
        </AsyncBoundary>

        {page && !error && <Pager page={page} onChange={goToOffset} />}
      </Card>
    </div>
  )
}
