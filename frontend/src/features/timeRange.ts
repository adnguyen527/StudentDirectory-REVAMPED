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
