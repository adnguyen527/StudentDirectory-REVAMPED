import { formatNumber } from '../api/bson'
import { getHomeTrends } from '../api/endpoints'
import type { TrendBucket, TrendsResponse } from '../api/types'
import { ColumnChart } from '../charts/BarChart'
import { bucketHint, bucketLabel } from '../charts/buckets'
import { useApi } from '../hooks/useApi'
import { Card } from '../shell/Card'
import { CardRow } from '../shell/CardRow'

interface Measure {
  title: string
  valueLabel: string
  of: (bucket: TrendBucket) => number
  /**
   * The line under the chart.
   *
   * ⚠️ Per measure rather than one shared "N over M months", because that sentence is not
   * true of all four. Three of these are quantities that add up across months; the student
   * count is a distinct count and does not, so printing its sum beside a note saying it
   * cannot be summed would contradict itself on screen.
   */
  summary: (buckets: TrendBucket[]) => string
}

function sum(buckets: TrendBucket[], of: (bucket: TrendBucket) => number) {
  return buckets.reduce((running, bucket) => running + of(bucket), 0)
}

/**
 * ⚠️ Four charts, not one with four series -- and this is the whole design of this row.
 *
 * Measured over the live data, a month holds roughly 1,760 sessions, 450 students, 8,450
 * pages and 46 unfinalized reports. On one shared axis the unfinalized line is a flat
 * smear along the baseline and the students line is nearly one too: two of the four
 * measures would be unreadable, and the two that were legible would imply a relationship
 * between quantities that share no unit. A second y-axis is the usual fix and is worse --
 * the alignment between two scales is arbitrary, so the chart invents a correlation the
 * data does not contain.
 *
 * Each measure gets its own axis, the same months underneath, and the reader compares
 * shapes rather than heights.
 */
const MEASURES: Measure[] = [
  {
    title: 'Sessions',
    valueLabel: 'Sessions',
    of: (bucket) => bucket.sessions,
    summary: (buckets) =>
      `${formatNumber(sum(buckets, (b) => b.sessions))} sessions over ${buckets.length} months.`,
  },
  {
    title: 'Students',
    valueLabel: 'Students',
    of: (bucket) => bucket.students ?? 0,
    // ⚠️ Distinct within a month, not across them: someone who came in February and again
    // in March is counted in both. So this one reports its busiest month rather than a
    // total -- a total here would exceed the number of students who exist.
    summary: (buckets) =>
      `Distinct students each month, at most ${formatNumber(
        Math.max(0, ...buckets.map((b) => b.students ?? 0)),
      )} in a month. Someone attending in two months counts in both, so these do not add up.`,
  },
  {
    title: 'Pages completed',
    valueLabel: 'Pages',
    of: (bucket) => bucket.pages_completed ?? 0,
    summary: (buckets) =>
      `${formatNumber(sum(buckets, (b) => b.pages_completed ?? 0))} pages over ${
        buckets.length
      } months.`,
  },
  {
    title: 'Unfinalized reports',
    valueLabel: 'Unfinalized',
    of: (bucket) => bucket.unfinalized ?? 0,
    // No finalized chart beside it: that figure is sessions minus this one, and two charts
    // that must agree are two charts that can disagree.
    summary: (buckets) =>
      `${formatNumber(
        sum(buckets, (b) => b.unfinalized ?? 0),
      )} still waiting to be finalized — the figure here a manager can act on.`,
  },
]

/**
 * Monthly activity across the programme.
 *
 * One request feeds all four charts: the route returns every measure per bucket, so asking
 * four times would be four scans of the same reports.
 *
 * In a CardRow rather than the tile row above it. `.tile-row` is the pinned-stats row and
 * is sized for a number and a label -- at 232px across a year of months a bar would be nine
 * pixels wide, and each measure needs its own titled card anyway to say which axis is which.
 */
export function HomeTrendsRow() {
  const { data, loading, error } = useApi<TrendsResponse>((signal) => getHomeTrends({}, signal), [])

  // Quiet rather than loud: the tiles above already carry the page's error, and a second
  // copy of the same failure says nothing new.
  if (error) return null

  const buckets = data?.buckets ?? []
  if (!loading && buckets.length === 0) return null

  const interval = data?.interval ?? 'month'

  return (
    <CardRow min={300}>
      {MEASURES.map((measure) => (
        <Card key={measure.title} title={measure.title} showOverflow={false}>
          <ColumnChart
            caption={`${measure.title} by month`}
            valueLabel={measure.valueLabel}
            loading={loading && !data}
            compact
            data={buckets.map((bucket) => ({
              key: bucket.key,
              label: bucketLabel(bucket.key, interval),
              // The months it covers, for the hover and the twin -- the axis stays terse.
              hint: bucketHint(bucket.start, bucket.end, interval),
              value: measure.of(bucket),
              partial: bucket.partial,
            }))}
            note={data ? measure.summary(buckets) : undefined}
          />
        </Card>
      ))}
    </CardRow>
  )
}
