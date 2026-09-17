import { Fragment, useState } from 'react'
// Libraries & hooks
import { Link } from 'react-router-dom'
import { useApi } from '../../hooks/useApi'
// apis
import { formatDate, formatNumber, isoDay, toDate, toId } from '../../api/bson'
import type { ExtDate } from '../../api/bson'
import { listReports } from '../../api/endpoints'
import type { ReportsResponse } from '../../api/types'
// components
import { AsyncBoundary } from '../../shell/AsyncBoundary'
import { Card } from '../../shell/Card'
import { Pager } from '../../shell/Pager'
import { DateRangeFilter } from '../DateRangeFilter'
import { OpenReportLink } from '../OpenReportLink'
import { ReportModal } from '../ReportModal'
// utils
import { useCardRange } from '../ranges'
import { durationMinutes, timeRange } from '../timeRange'
// styles
import './Centers.css'

/** Fewer than the 50 a list page shows: this is one card among several, not the page. */
const ROWS = 10

interface CenterSessionsCardProps {
  centers: string[]
  /**
   * The newest session at the selected centers, from /api/centers/metrics -- the day this
   * card opens on.
   *
   * ⚠️ The selection's newest session, not the dataset's. Today every center ran on
   * 2025-09-17 so the two agree, but the moment one closes or lags an import, the global
   * date would open that center's card empty -- which reads as a broken card rather than a
   * quiet day. routes/students.py refuses to default a period for the same reason.
   */
  lastSession: ExtDate | null
  /** While the anchor is still in flight there is no honest window to ask the API for. */
  anchorLoading: boolean
}

/**
 * Sessions at the selected centers, over a period the card owns.
 *
 * Opens on the most recent day of sessions rather than on everything -- against a live
 * database this would be "today", and the imported data's equivalent is its last session
 * date. Widening it is one click, and Clear means Any time as it does on every other filter.
 *
 * ⚠️ **The date range stops here.** The student and instructor cards beside this one are
 * all-time and say so in their titles. One range governing the whole dashboard was the
 * alternative; keeping it on the card that is actually about time means the other two can
 * read straight from the built aggregates instead of being recomputed per period.
 *
 * Filtering is server-side, unlike SessionHistoryCard, which narrows rows it already holds.
 * That card has one student's history in hand -- a few dozen rows. A center has twelve
 * thousand, so the range and the centers go into the query and the card pages through the
 * answer.
 */
export function CenterSessionsCard({
  centers,
  lastSession,
  anchorLoading,
}: CenterSessionsCardProps) {
  const period = useCardRange()
  const [offset, setOffset] = useState(0)
  const [openReportId, setOpenReportId] = useState<string | null>(null)

  const anchor = toDate(lastSession)
  const anchorDay = anchor ? isoDay(anchor) : ''

  // Seeded to the anchor day the first time it arrives, and again only if the day itself
  // changes -- so switching between centers that share a last session date leaves a window
  // the reader chose by hand alone. Adjusted during render rather than in an effect, the
  // idiom DateRangeFilter and the offset reset below already use: an effect would render
  // once with the wrong window and again with the right one.
  const [anchorSeed, setAnchorSeed] = useState('')
  if (anchorDay && anchorDay !== anchorSeed) {
    setAnchorSeed(anchorDay)
    period.apply(anchorDay, anchorDay)
  }

  // The API's own spelling for a date range -- routes/filtering.py, BOUNDS. Blank bounds
  // are left out rather than sent empty, as rangeParams does for the URL-backed filters.
  const ranges: Record<string, string> = {}
  if (period.low) ranges.date_from = period.low
  if (period.high) ranges.date_to = period.high

  const centerKey = centers.join('|')
  const rangeKey = `${period.low}|${period.high}`

  /**
   * Asking before the anchor resolves would fetch every session ever, then immediately
   * fetch the one day -- two requests and a flash of rows the reader did not ask for.
   *
   * Once it has resolved, an absent anchor is not a reason to wait forever: the centers
   * request failed, or the selection genuinely has no sessions. Either way the card falls
   * through to Any time and shows a real answer instead of a permanent "Loading…".
   */
  const waiting = anchorLoading && !anchorSeed

  const { data, loading, error } = useApi<ReportsResponse | null>(
    (signal) =>
      waiting
        // AttendancePanel does the same to skip a request it knows the answer to.
        ? Promise.resolve(null)
        : listReports({ limit: ROWS, offset, centers, ranges }, signal),
    // Primitives only: useApi compares deps by identity and a fresh array every render
    // would refetch forever.
    [centerKey, rangeKey, offset, waiting],
  )

  // A narrower period is not page 4 of the wider one. Reset during render rather than in
  // an effect, the idiom the list pages already use for the same problem.
  const [mark, setMark] = useState(`${centerKey}|${rangeKey}`)
  if (mark !== `${centerKey}|${rangeKey}`) {
    setMark(`${centerKey}|${rangeKey}`)
    setOffset(0)
  }

  const page = data?.page

  return (
    <Card
      title="Sessions"
      controls={
        <DateRangeFilter column="date" label="session date" standalone range={period} />
      }
      flush
    >
      <AsyncBoundary
        loading={loading || waiting}
        error={error}
        empty={data?.reports.length === 0}
        emptyMessage={
          period.active
            ? 'No sessions at these centers in this period.'
            : 'No sessions at these centers.'
        }
      >
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Student</th>
                <th>Instructor</th>
                <th className="numeric">Pages</th>
                <th className="numeric">Length</th>
                <th>Status</th>
                {/* Unlabelled, as on the reports list: the column holds an action. */}
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.reports.map((report) => {
                const id = toId(report._id) ?? ''
                const minutes = durationMinutes(report)
                return (
                  <tr key={id}>
                    <td>
                      {formatDate(report.date)}
                      <div className="row-sub">{timeRange(report)}</div>
                    </td>
                    {/* Linked as on every other table in the app. No stopPropagation
                        here, unlike ReportsTable: that row is itself a click target that
                        toggles an expander, and these rows are inert. */}
                    <td className="primary-name">
                      <Link
                        className="row-link"
                        to={`/students/${encodeURIComponent(report.student_key)}`}
                      >
                        {report.student_name}
                      </Link>
                      <div className="row-sub">{report.centers[0]}</div>
                    </td>
                    <td>
                      {report.instructors?.length ? (
                        report.instructors.map((name, index) => (
                          <Fragment key={name}>
                            {index > 0 && ', '}
                            <Link
                              className="row-link"
                              to={`/instructors/${encodeURIComponent(name)}`}
                            >
                              {name}
                            </Link>
                          </Fragment>
                        ))
                      ) : (
                        // Not a gap so much as a fact about the row: 73 sessions named an
                        // instructor who does not exist, and ingestion drops the name
                        // rather than inventing a person -- see PLACEHOLDER_INSTRUCTORS.
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="numeric">{formatNumber(report.pages_completed)}</td>
                    <td className="numeric">
                      {minutes === null ? (
                        // A start with no end is 0.7% of sessions. A zero would read as a
                        // session that took no time rather than one nobody timed.
                        <span className="muted">—</span>
                      ) : (
                        `${formatNumber(minutes)} min`
                      )}
                    </td>
                    <td>
                      {report.finalized ? (
                        <span className="muted">Finalized</span>
                      ) : (
                        <span className="tag tag-warn">Unfinalized</span>
                      )}
                    </td>
                    <td>
                      <OpenReportLink
                        reportId={id}
                        label={`Open the ${formatDate(report.date)} session for ${report.student_name}`}
                        onOpen={setOpenReportId}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </AsyncBoundary>
      {page && !error && <Pager page={page} onChange={setOffset} />}

      {openReportId && (
        <ReportModal reportId={openReportId} onClose={() => setOpenReportId(null)} />
      )}
    </Card>
  )
}
