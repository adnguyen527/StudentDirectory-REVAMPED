// apis
import { formatTime } from '../api/bson'
import type { DwpReport } from '../api/types'

/**
 * "5:53 PM – 6:53 PM", or just the start. Sessions without an end are 0.7% of the data.
 *
 * Its own module rather than a helper inside one of the two tables that render a session
 * row -- SessionHistoryCard and ReportsTable -- because a file that exports a component and
 * a function alongside it breaks fast refresh, and the two have to agree on this anyway.
 *
 * Takes only the fields it reads, so the list route's narrower row satisfies it too.
 */
export function timeRange(report: Pick<DwpReport, 'session_start' | 'session_end'>): string {
  if (!report.session_start) return '—'
  const start = formatTime(report.session_start)
  return report.session_end ? `${start} – ${formatTime(report.session_end)}` : start
}

/**
 * The session's own length in minutes, which is not stored -- only its two ends are.
 *
 * Null rather than 0 when either end is missing: 0.7% of sessions record a start and no
 * end, and a zero there would read as a session that took no time rather than one whose
 * length nobody can know.
 *
 * Lives beside timeRange because it answers the same question off the same two fields --
 * the row shows when a session ran, this says for how long -- and because the detail body
 * and the metrics row both need it.
 */
export function durationMinutes(
  report: Pick<DwpReport, 'session_start' | 'session_end'>,
): number | null {
  if (!report.session_start || !report.session_end) return null
  const start = Date.parse(report.session_start.$date as string)
  const end = Date.parse(report.session_end.$date as string)
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  return Math.round((end - start) / 60000)
}
