import { useSearchParams } from 'react-router-dom'

import { formatNumber } from '../api/bson'
import { getInstructorDistribution, getStudentDistribution } from '../api/endpoints'
import type { DistributionResponse } from '../api/types'
import { BarChart } from '../charts/BarChart'
import { useApi } from '../hooks/useApi'
import { Card } from '../shell/Card'
import { CHART_PARAM, useChartToggle } from './useChartToggle'
import { rangeKey, rangeParams, type RangeColumns } from './ranges'

interface CenterDistributionCardProps {
  kind: 'students' | 'instructors'
  /** The list's filterable columns, so the chart reads the same bounds the table does. */
  filterColumns: RangeColumns
}

const COPY = {
  students: {
    title: 'Students by centre',
    noun: 'students',
    show: 'Show centre chart',
    hide: 'Hide centre chart',
  },
  instructors: {
    title: 'Instructors by centre',
    noun: 'instructors',
    show: 'Show centre chart',
    hide: 'Hide centre chart',
  },
} as const

/**
 * How the list below divides across centres.
 *
 * It reads the URL itself rather than taking the page's filter state as props, which makes
 * the one decision worth protecting local and greppable: **paging is deliberately not a
 * dependency**. `offset`, `sort` and `direction` position the list without narrowing it, so
 * turning a page cannot change these bars -- passing them would refetch an identical answer
 * on every click. Keeping that here means no caller has to remember it.
 *
 * The chart mounts only while open, so a collapsed chart costs no request at all: the
 * distribution is a group-by over the whole filtered set, not over the page on screen.
 */
export function CenterDistributionCard({ kind, filterColumns }: CenterDistributionCardProps) {
  const [open, toggle] = useChartToggle(false)
  const copy = COPY[kind]

  return (
    <Card
      title={copy.title}
      showOverflow={false}
      controls={
        <button
          type="button"
          className={open ? 'button button-on' : 'button'}
          aria-expanded={open}
          onClick={toggle}
        >
          {open ? copy.hide : copy.show}
        </button>
      }
    >
      {open ? (
        <Distribution kind={kind} filterColumns={filterColumns} />
      ) : (
        <p className="muted chart-collapsed">
          {`See how the ${copy.noun} in this list are spread across centres.`}
        </p>
      )}
    </Card>
  )
}

function Distribution({ kind, filterColumns }: CenterDistributionCardProps) {
  const [params] = useSearchParams()
  const query = params.get('query') ?? ''
  const centers = params.getAll('center')
  const centerKey = centers.join('|')
  const ranges = rangeParams(params, filterColumns)
  const rangesKey = rangeKey(ranges)

  const { data, loading, error } = useApi<DistributionResponse>(
    (signal) =>
      (kind === 'students' ? getStudentDistribution : getInstructorDistribution)(
        { query, centers, ranges },
        signal,
      ),
    // ⚠️ No offset, sort or direction -- see the note above. Primitives only: useApi
    // compares deps by identity.
    [kind, query, centerKey, rangesKey],
  )

  if (error) {
    return (
      <div className="state-error" role="alert">
        <strong>{error.status ? `Error ${error.status}` : 'Cannot reach the API'}</strong>
        {error.displayMessage}
      </div>
    )
  }

  const bars = data?.distribution ?? []
  if (!loading && bars.length === 0) {
    return <p className="state">No {COPY[kind].noun} match these filters.</p>
  }

  return (
    <BarChart
      caption={COPY[kind].title}
      valueLabel={kind === 'students' ? 'Students' : 'Instructors'}
      loading={loading && !data}
      data={bars.map((row) => ({ key: row.center, label: row.center, value: row.count }))}
      note={data ? summary(kind, data) : undefined}
    />
  )
}

/**
 * The line under the bars, and the reason this chart needs one.
 *
 * ⚠️ The instructor bars do not sum to the roster. 11 of 103 instructors work at more than
 * one centre and appear under each -- one person, two bars -- so `counted` runs above
 * `total`, and a reader who cannot see that reads the overshoot as an error. Saying it
 * plainly is cheaper than a footnote nobody reads, and it says nothing at all on the
 * student chart, where the two agree because a student belongs to exactly one centre.
 */
function summary(kind: 'students' | 'instructors', data: DistributionResponse) {
  const parts: string[] = []

  if (data.counted > data.total) {
    parts.push(
      `${formatNumber(data.counted)} centre appearances across ` +
        `${formatNumber(data.total)} ${COPY[kind].noun} — someone working at two centres ` +
        'is counted under each.',
    )
  } else {
    parts.push(`${formatNumber(data.total)} ${COPY[kind].noun}.`)
  }

  if (data.no_center > 0) {
    parts.push(`${formatNumber(data.no_center)} with no centre recorded.`)
  }

  return parts.join(' ')
}

export { CHART_PARAM }
