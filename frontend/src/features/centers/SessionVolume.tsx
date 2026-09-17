// libraries & hooks
import { useApi } from '../../hooks/useApi'
// apis
import { formatDate, formatNumber } from '../../api/bson'
import { getReportTrends } from '../../api/endpoints'
import type { TrendsResponse } from '../../api/types'
// components
import { ColumnChart } from '../../charts/BarChart'
// utils
import { bucketHint, bucketLabel } from '../../charts/buckets'

const INTERVAL_NOUN = { day: 'day', week: 'week', month: 'month' } as const

export type Interval = keyof typeof INTERVAL_NOUN

interface SessionVolumeProps {
  centers: string[]
  /** `centers.join('|')` -- useApi compares deps by identity. */
  centerKey: string
  ranges: Record<string, string>
  rangesKey: string
  interval: Interval
  /** True while the anchor that decides the bucket width is still in flight. */
  waiting: boolean
}

/**
 * Sessions per bucket, for the card's opening view.
 *
 * The one view here that a period means something to: these are counted from `dwp_reports`
 * by session date, so narrowing the window narrows what happened in it. The two
 * distribution views count collections instead and cannot answer that -- see
 * CenterDistribution.
 */
export function SessionVolume({
  centers,
  centerKey,
  ranges,
  rangesKey,
  interval,
  waiting,
}: SessionVolumeProps) {
  const { data, loading, error } = useApi<TrendsResponse | null>(
    (signal) =>
      waiting
        // The idiom CenterSessionsCard and AttendancePanel both use to skip a request
        // whose answer would immediately be thrown away.
        ? Promise.resolve(null)
        : getReportTrends({ centers, ranges, interval }, signal),
    [centerKey, rangesKey, interval, waiting],
  )

  if (error) {
    return (
      <div className="state-error" role="alert">
        <strong>{error.status ? `Error ${error.status}` : 'Cannot reach the API'}</strong>
        {error.displayMessage}
      </div>
    )
  }

  // ⚠️ The interval the API answered with, not the one asked for. The route resolves the
  // window itself -- a default range when none was given -- so its own reading is the one
  // the bucket keys are spelled in, and labelling them by the request would mislabel any
  // response that differed.
  const shown = data?.interval ?? interval
  const buckets = data?.buckets ?? []
  if (!loading && !waiting && buckets.length === 0) {
    return <p className="state">No sessions at these centers in this period.</p>
  }

  return (
    <ColumnChart
      caption="Sessions over time"
      valueLabel="Sessions"
      loading={(loading || waiting) && !data}
      data={buckets.map((bucket) => ({
        key: bucket.key,
        label: bucketLabel(bucket.key, shown),
        // The days it covers, for the hover and the table twin -- the axis stays terse.
        hint: bucketHint(bucket.start, bucket.end, shown),
        value: bucket.sessions,
        partial: bucket.partial,
      }))}
      note={data ? note(data, shown) : undefined}
    />
  )
}

/**
 * The line under the bars: the window, and what a dimmed bar means.
 *
 * ⚠️ The partial note is not decoration. The window is used exactly as asked rather than
 * widened to whole buckets, so an edge bar can be short because the window is short, and
 * without saying so that reads as a quiet week.
 */
function note(data: TrendsResponse, interval: Interval) {
  const total = data.buckets.reduce((sum, bucket) => sum + bucket.sessions, 0)
  const parts = [`${formatNumber(total)} sessions by ${INTERVAL_NOUN[interval]}`]

  if (data.range) {
    parts[0] += `, ${formatDate(data.range.start)} to ${formatDate(data.range.end)}`
  }
  parts[0] += '.'

  if (data.buckets.some((bucket) => bucket.partial)) {
    parts.push(
      `Dimmed ${INTERVAL_NOUN[interval]}s are only part covered by this period, ` +
        'so they are short because the window is.',
    )
  }

  return parts.join(' ')
}
