// libraries & hooks
import { useApi } from '../../hooks/useApi'
// apis
import { formatNumber } from '../../api/bson'
import { getInstructorDistribution, getStudentDistribution } from '../../api/endpoints'
import type { DistributionResponse } from '../../api/types'
// components
import { BarChart } from '../../charts/BarChart'
// utils
import { nounFor } from '../orderPhrase'

export const DISTRIBUTION_COPY = {
  students: {
    title: 'Students by center',
    noun: 'students',
    singular: 'student',
    valueLabel: 'Students',
  },
  instructors: {
    title: 'Instructors by center',
    noun: 'instructors',
    singular: 'instructor',
    valueLabel: 'Instructors',
  },
} as const

export type DistributionKind = keyof typeof DISTRIBUTION_COPY

interface CenterDistributionProps {
  kind: DistributionKind
  /** The page's center selection, as `CenterBar` wrote it into the URL. */
  centers: string[]
  /** `centers.join('|')` -- useApi compares deps by identity, so the array cannot be one. */
  centerKey: string
}

/**
 * How the people on record divide across centers.
 *
 * ⚠️ **All-time, and not datable.** These count the `students` and `instructors`
 * collections, where the only date to filter on is `last_session_date` -- "whose *last*
 * session fell in this window", which is not what a period filter means. Measured on the
 * live data, asking for Jan-Mar 2025 that way returns 79 students where 525 actually
 * attended. So the card above deliberately withholds its date filter on these two views
 * rather than wiring a number that would look plausible and be wrong by 6x.
 * `routes/students.py` says the same thing from the other end: this endpoint answers how
 * these rows divide up, not what happened in a period.
 *
 * No query or range filters either, unlike when this chart lived above the students list:
 * there is no list here to agree with, and the center selection is the whole of the
 * narrowing this page does.
 */
export function CenterDistribution({ kind, centers, centerKey }: CenterDistributionProps) {
  const { data, loading, error } = useApi<DistributionResponse>(
    (signal) =>
      (kind === 'students' ? getStudentDistribution : getInstructorDistribution)(
        { centers },
        signal,
      ),
    [kind, centerKey],
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
    return <p className="state">No {DISTRIBUTION_COPY[kind].noun} at these centers.</p>
  }

  return (
    <BarChart
      caption={DISTRIBUTION_COPY[kind].title}
      valueLabel={DISTRIBUTION_COPY[kind].valueLabel}
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
 * one center and appear under each -- one person, two bars -- so `counted` runs above
 * `total`, and a reader who cannot see that reads the overshoot as an error. Saying it
 * plainly is cheaper than a footnote nobody reads, and it says nothing at all on the
 * student chart, where the two agree because a student belongs to exactly one center.
 */
function summary(kind: DistributionKind, data: DistributionResponse) {
  const parts: string[] = []

  if (data.counted > data.total) {
    parts.push(
      `${formatNumber(data.counted)} center appearances across ` +
        `${formatNumber(data.total)} ${nounFor(data.total, DISTRIBUTION_COPY[kind].singular)} — someone ` +
        'working at two centers ' +
        'is counted under each.',
    )
  } else {
    parts.push(
      `${formatNumber(data.total)} ${nounFor(data.total, DISTRIBUTION_COPY[kind].singular)}.`,
    )
  }

  if (data.no_center > 0) {
    parts.push(`${formatNumber(data.no_center)} with no center recorded.`)
  }

  // ⚠️ Said on every distribution view, because the card's date filter is hidden rather
  // than disabled here: without this line the reader has no way to tell that the window
  // they set on the sessions view is not being applied to these bars.
  parts.push('All-time — this view is not dated.')

  return parts.join(' ')
}
