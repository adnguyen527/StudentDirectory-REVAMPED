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
import { ListFilter } from './ListFilter'

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

  const { data, loading, error } = useApi<InstructorsResponse>(
    (signal) => listInstructors({ limit: PAGE_SIZE, offset, query, centers }, signal),
    [query, offset, centerKey],
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
            ? `${formatNumber(page.total)} ${query ? 'matching' : 'in total'}, sorted by name.`
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
        controls={
          query ? (
            <button
              type="button"
              className="button"
              // The offset goes with the filter -- page 2 of the filtered list is not
              // page 2 of the whole.
              onClick={() => setParams(new URLSearchParams())}
            >
              Clear filter
            </button>
          ) : undefined
        }
      >
        <AsyncBoundary
          loading={loading}
          error={error}
          empty={data?.instructors.length === 0}
          emptyMessage={
            query ? `No instructors match “${query}”.` : 'No instructors in the database yet.'
          }
        >
          <InstructorsTable instructors={data?.instructors ?? []} />
        </AsyncBoundary>

        {page && !error && <Pager page={page} onChange={goToOffset} />}
      </Card>
    </div>
  )
}
