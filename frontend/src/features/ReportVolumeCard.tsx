import { useSearchParams } from 'react-router-dom'

import { formatDate, formatNumber, isoDay, toDate } from '../api/bson'
import { getMetrics, getReportTrends } from '../api/endpoints'
import type { Metrics, TrendsResponse } from '../api/types'
import { bucketHint, bucketLabel, pickInterval } from '../charts/buckets'
import { ColumnChart } from '../charts/BarChart'
import { useApi } from '../hooks/useApi'
import { Card } from '../shell/Card'
import { rangeKey, rangeParams, type RangeColumns } from './ranges'
import { useChartToggle } from './useChartToggle'

/** The one column the reports list bounds -- models/dwp_report.py, FILTERABLE. */
const FILTER_COLUMNS: RangeColumns = { date: 'date' }

const INTERVAL_NOUN = { day: 'day', week: 'week', month: 'month' } as const

/**
 * Sessions over time, above the reports list.
 *
 * Open on arrival, unlike the centre charts. The reports list is the one page here entered
 * with a period already in mind -- ReportsPage says so about its filters -- and "how much
 * happened when" is the question that brings someone to it, so the shape of the period is
 * worth showing before it is asked for.
 *
 * It reads the list's own `?date_from=` and `?date_to=` straight from the URL, so the bars
 * and the table are one query drawn twice, and moving the date filter moves both.
 */
export function ReportVolumeCard() {
  const [open, toggle] = useChartToggle(true)
  const [params] = useSearchParams()

  const query = params.get('query') ?? ''
  const centers = params.getAll('center')
  const centerKey = centers.join('|')
  const ranges = rangeParams(params, FILTER_COLUMNS)
  const rangesKey = rangeKey(ranges)

  // The window's far end, for picking a bucket width only.
  //
  // ⚠️ An open end is not an unknown window. The date filter's presets set only a start
  // ("Since 18 Aug"), and the route resolves the other end to the newest session in the
  // data. Without standing that in, a one-month window reads as a window of unknown width,
  // asks for monthly buckets, and draws itself as a single bar.
  const metrics = useApi<Metrics>((signal) => getMetrics(signal), [])
  const anchor = toDate(metrics.data?.latest_session_date ?? null)
  const anchorDay = anchor ? isoDay(anchor) : ''

  // The bucket width is a presentation choice, not a filter: the API serves any of the
  // three for any window, and a year of daily bars is a texture rather than a chart.
  const interval = pickInterval(ranges.date_from, ranges.date_to || anchorDay || undefined)

  // Asking before the anchor lands would fetch monthly buckets and then immediately refetch
  // daily ones -- two requests and a chart that changes shape under the reader. Only worth
  // waiting for when a bound is actually missing; a closed window needs no anchor at all.
  const waiting = !ranges.date_to && !anchorDay && metrics.loading

  return (
    <Card
      title="Sessions over time"
      showOverflow={false}
      controls={
        <button
          type="button"
          className={open ? 'button button-on' : 'button'}
          aria-expanded={open}
          onClick={toggle}
        >
          {open ? 'Hide chart' : 'Show chart'}
        </button>
      }
    >
      {open ? (
        <Volume
          query={query}
          centers={centers}
          centerKey={centerKey}
          ranges={ranges}
          rangesKey={rangesKey}
          interval={interval}
          waiting={waiting}
        />
      ) : (
        <p className="muted chart-collapsed">
          See how these sessions are spread over the period.
        </p>
      )}
    </Card>
  )
}

interface VolumeProps {
  query: string
  centers: string[]
  centerKey: string
  ranges: Record<string, string>
  rangesKey: string
  interval: 'day' | 'week' | 'month'
  /** True while the anchor that decides the bucket width is still in flight. */
  waiting: boolean
}

function Volume({ query, centers, centerKey, ranges, rangesKey, interval, waiting }: VolumeProps) {
  const { data, loading, error } = useApi<TrendsResponse | null>(
    (signal) =>
      waiting
        // The idiom CenterSessionsCard and AttendancePanel both use to skip a request
        // whose answer would immediately be thrown away.
        ? Promise.resolve(null)
        : getReportTrends({ query, centers, ranges, interval }, signal),
    // Paging is absent on purpose, as on the centre charts: turning a page of the table
    // cannot change how the period divides up.
    [query, centerKey, rangesKey, interval, waiting],
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
    return <p className="state">No sessions match these filters.</p>
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
 * widened to whole buckets -- the table below is filtered by the same dates, and a chart
 * that quietly counted more would disagree with it. The price is that an edge bar can be
 * short because the window is short, and without saying so that reads as a quiet week.
 */
function note(data: TrendsResponse, interval: 'day' | 'week' | 'month') {
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
