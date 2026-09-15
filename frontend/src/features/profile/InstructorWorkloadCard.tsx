import { useState } from 'react'

import { formatNumber, isoDay, toDate } from '../../api/bson'
import type { ExtDate } from '../../api/bson'
import { getInstructorTrends } from '../../api/endpoints'
import type { TrendBucket, TrendsResponse } from '../../api/types'
import { ColumnChart } from '../../charts/BarChart'
import { bucketHint, bucketLabel, pickInterval } from '../../charts/buckets'
import { useApi } from '../../hooks/useApi'
import { Card } from '../../shell/Card'
import { DateRangeFilter } from '../DateRangeFilter'
import { useCardRange } from '../ranges'

type MetricKey = 'sessions' | 'students' | 'pages_completed'

interface Metric {
  key: MetricKey
  label: string
  of: (bucket: TrendBucket) => number
  /** The line under the chart. Takes the bucket noun, which the window decides. */
  summary: (buckets: TrendBucket[], per: string) => string
}

function sum(buckets: TrendBucket[], of: (bucket: TrendBucket) => number) {
  return buckets.reduce((running, bucket) => running + of(bucket), 0)
}

const METRICS: Metric[] = [
  {
    key: 'sessions',
    label: 'Sessions',
    of: (bucket) => bucket.sessions,
    summary: (buckets) =>
      `${formatNumber(sum(buckets, (b) => b.sessions))} sessions in this period.`,
  },
  {
    key: 'students',
    label: 'Students',
    of: (bucket) => bucket.students ?? 0,
    // ⚠️ Distinct within a bucket, so the busiest bucket rather than a total -- a sum here
    // would exceed the roster.
    // ⚠️ The noun follows the window: three months buckets by week, so "each month" would
    // be describing bars that are not months. The caveat is the same whatever the width.
    summary: (buckets, per) =>
      `Distinct students each ${per}, at most ${formatNumber(
        Math.max(0, ...buckets.map((b) => b.students ?? 0)),
      )} in one. Someone taught in two ${per}s counts in both, so these do not add up.`,
  },
  {
    key: 'pages_completed',
    label: 'Pages',
    of: (bucket) => bucket.pages_completed ?? 0,
    /**
     * ⚠️ The warning this option exists to carry.
     *
     * A co-taught session credits its pages in full to every instructor on it -- pages are
     * copied, not split. That is the right answer to "how much work happened in sessions I
     * ran", and the wrong one for any sum across people: program-wide the same arithmetic
     * gives 168,623 pages against the 153,360 actually recorded.
     */
    summary: (buckets) =>
      `${formatNumber(
        sum(buckets, (b) => b.pages_completed ?? 0),
      )} pages in sessions they ran. A co-taught session's pages count in full for each ` +
      'instructor on it, so these cannot be added across people.',
  },
]

/** How far back the card opens on. Three months of weekly bars is about 13 of them. */
const DEFAULT_MONTHS = 3

/**
 * The three months ending at **this instructor's** last session.
 *
 * Not today: the imported data ends well before the calendar does, so a window measured
 * back from now opens every card empty and reads as a broken panel rather than a quiet
 * quarter. And not the dataset's newest session either -- an instructor who left in March
 * would open on an empty summer. AttendancePanel anchors on its own student for exactly
 * this reason, and CenterSessionsCard on its own selection.
 *
 * ⚠️ Stepped in UTC. These are naive wall-clock dates read back as UTC, and `setMonth` on a
 * local reading drifts the boundary by a day in any non-UTC zone -- which the suite's pinned
 * America/Chicago would catch.
 */
function defaultPeriod(lastSessionDate: ExtDate | null): { low: string; high: string } {
  const end = toDate(lastSessionDate)
  if (!end) return { low: '', high: '' }

  const start = new Date(end)
  start.setUTCMonth(start.getUTCMonth() - DEFAULT_MONTHS)
  return { low: isoDay(start), high: isoDay(end) }
}

interface InstructorWorkloadCardProps {
  instructorName: string
  /** The instructor's newest session -- the day the default window ends on. */
  lastSessionDate: ExtDate | null
}

/**
 * How much one instructor taught, over time.
 *
 * Read from `dwp_reports` through /api/instructors/trends rather than from the instructor
 * aggregate, which is all-time and so cannot answer a period at all.
 *
 * One instructor, one line. Comparing several as separate series is a different response
 * shape and a different chart; the endpoint answers a union, not a breakdown.
 */
export function InstructorWorkloadCard({
  instructorName,
  lastSessionDate,
}: InstructorWorkloadCardProps) {
  const [metricKey, setMetricKey] = useState<MetricKey>('sessions')
  const period = useCardRange()

  // Seeded to the default window the first time this instructor's anchor arrives, and again
  // only if the anchor itself changes -- so moving between two instructors who last taught
  // on the same day leaves a window the reader chose by hand alone.
  //
  // Adjusted during render rather than in an effect, the idiom CenterSessionsCard and the
  // list pages already use: an effect would fire one request for the whole of time and then
  // a second for the three months actually wanted.
  const anchorDay = lastSessionDate ? isoDay(toDate(lastSessionDate) ?? new Date(0)) : ''
  const [seed, setSeed] = useState('')
  if (anchorDay && anchorDay !== seed) {
    setSeed(anchorDay)
    const seeded = defaultPeriod(lastSessionDate)
    period.apply(seeded.low, seeded.high)
  }

  // The API's own spelling -- routes/filtering.py, BOUNDS. A blank bound is left out rather
  // than sent empty, so clearing the filter means "any time" and lets the route default.
  const ranges: Record<string, string> = {}
  if (period.low) ranges.date_from = period.low
  if (period.high) ranges.date_to = period.high

  // Three months lands on weekly bars; narrowing to a fortnight gives days and widening to
  // a year gives months. A presentation choice, not a filter -- see charts/buckets.ts.
  //
  // ⚠️ An open end is not an unknown window. The filter's own presets set only a start
  // ("Since 18 Aug"), and the route resolves the other end to the newest session -- a date
  // this card already holds. Without standing that in, a one-month window reads as a window
  // of unknown width, asks for monthly buckets, and draws itself as a single bar.
  const asked = pickInterval(ranges.date_from, ranges.date_to || anchorDay || undefined)
  const rangeKey = `${period.low}|${period.high}`

  const { data, loading, error } = useApi<TrendsResponse>(
    (signal) =>
      getInstructorTrends({ instructors: [instructorName], ranges, interval: asked }, signal),
    // ⚠️ The metric is deliberately absent. One response carries all three measures, so
    // switching is a client-side projection -- putting it here would refetch identical data
    // and flash the skeleton, because useApi sets loading on every dep change.
    //
    // The window is not: a different period is a different question, and only the route can
    // answer it.
    [instructorName, rangeKey, asked],
  )

  const metric = METRICS.find((candidate) => candidate.key === metricKey) ?? METRICS[0]
  const buckets = data?.buckets ?? []
  // The interval the route answered with, not the one asked for -- it resolves the window
  // itself, so its own reading is the one the bucket keys are spelled in.
  const interval = data?.interval ?? asked

  return (
    <Card
      title="Workload over time"
      showOverflow={false}
      controls={
        // Two controls in one header, wrapping rather than crowding. The wrap is
        // unconditional for the reason .period states in Profile.css: a viewport media
        // query cannot see how wide *this card* is.
        <div className="card-controls-wrap">
          <DateRangeFilter column="date" label="session date" standalone range={period} />

          {/* A group rather than loose buttons: they are one control with three positions,
              and aria-pressed is how CenterBar's pills say which is on. */}
          <div className="metric-switch" role="group" aria-label="Measure">
            {METRICS.map((candidate) => (
              <button
                key={candidate.key}
                type="button"
                className={
                  candidate.key === metricKey ? 'button button-row button-on' : 'button button-row'
                }
                aria-pressed={candidate.key === metricKey}
                onClick={() => setMetricKey(candidate.key)}
              >
                {candidate.label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {error ? (
        <div className="state-error" role="alert">
          <strong>{error.status ? `Error ${error.status}` : 'Cannot reach the API'}</strong>
          {error.displayMessage}
        </div>
      ) : !loading && buckets.length === 0 ? (
        <p className="state">
          {period.active
            ? 'No sessions in this period.'
            : 'No sessions recorded for this instructor.'}
        </p>
      ) : (
        <ColumnChart
          caption={`${metric.label} by month`}
          valueLabel={metric.label}
          loading={loading && !data}
          data={buckets.map((bucket) => ({
            key: bucket.key,
            label: bucketLabel(bucket.key, interval),
            hint: bucketHint(bucket.start, bucket.end, interval),
            value: metric.of(bucket),
            partial: bucket.partial,
          }))}
          note={data ? metric.summary(buckets, interval) : undefined}
        />
      )}
    </Card>
  )
}
