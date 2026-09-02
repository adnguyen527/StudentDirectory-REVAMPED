import { useSearchParams } from 'react-router-dom'

import { formatNumber } from '../api/bson'
import { PAGE_SIZE, listTopics } from '../api/endpoints'
import type { TopicsResponse } from '../api/types'
import { useApi } from '../hooks/useApi'
import { AsyncBoundary } from '../shell/AsyncBoundary'
import { Card } from '../shell/Card'
import { Pager } from '../shell/Pager'
import { ListFilter } from './ListFilter'
import { TopicsTable } from './TopicsTable'

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

  const { data, loading, error } = useApi<TopicsResponse>(
    (signal) => listTopics({ limit: PAGE_SIZE, offset, query }, signal),
    [query, offset],
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
            ? `${formatNumber(page.total)} ${query ? 'matching' : 'in total'}, most worked first.`
            : 'Most worked first.'}
        </p>
      </div>

      {/* No title: the <h1> above already says Topics. The placeholder says what the
          box matches -- the id is a real handle, and the only thing separating two topics
          that share a name. */}
      <Card flush lead={<ListFilter placeholder="Search topics by name or id" />}>
        <AsyncBoundary
          loading={loading}
          error={error}
          empty={data?.topics.length === 0}
          emptyMessage={
            query ? `No topics match “${query}”.` : 'No topics in the database yet.'
          }
        >
          <TopicsTable topics={data?.topics ?? []} />
        </AsyncBoundary>

        {page && !error && <Pager page={page} onChange={goToOffset} />}
      </Card>
    </div>
  )
}
