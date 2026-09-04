import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { formatDate, formatNumber } from '../../api/bson'
import { decodeEntities } from '../../api/text'
import type { DwpReport } from '../../api/types'
import { Card } from '../../shell/Card'
import { DateRangeFilter } from '../DateRangeFilter'
import { useCardRange } from '../ranges'
import { timeRange } from '../timeRange'
import { Pager } from '../../shell/Pager'
import './Profile.css'

const ROWS_PER_PAGE = 25

/** One labelled block of prose, or nothing at all -- never an empty labelled section.
 *  Exported for ReportsTable, which builds the same expander. */
export function Note({ label, value, internal }: { label: string; value: string | null; internal?: boolean }) {
  if (!value?.trim()) return null
  return (
    <div className="note">
      <span className={internal ? 'note-label note-label-internal' : 'note-label'}>{label}</span>
      {/* The exports encode emoji as HTML character references, so a tenth of these notes
          would otherwise end in literal "&#128218;". Decoded to text, still escaped. */}
      <p className="note-body">{decodeEntities(value)}</p>
    </div>
  )
}

interface SessionHistoryCardProps {
  reports: DwpReport[]
}

/**
 * Every session, newest first as the API sorts them.
 *
 * Paged in the browser over the array already in memory -- the detail route returns all
 * of them in one response, so a page change here costs nothing. Pager holds no page
 * number of its own, which is what lets a locally-built envelope drive it.
 *
 * The columns are the fields that are actually populated: card_level, stars_*,
 * student_goal* and schoolwork_* sit under 17% across the collection and would be dead
 * columns on nearly every student. Notes go in the expander rather than a column because
 * they are prose.
 */
export function SessionHistoryCard({ reports }: SessionHistoryCardProps) {
  const [offset, setOffset] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  // Local rather than the URL: every session is already in hand, so this narrows what is
  // on screen and has no request to make. Same hook the instructor columns above use.
  const period = useCardRange()

  const shown = useMemo(() => {
    if (!period.active) return reports
    // Compared as YYYY-MM-DD text, which is what <input type="date"> gives and what the
    // API's own date bounds parse -- and it sidesteps the timezone question entirely,
    // since these dates are stored at midnight and rendered in UTC.
    const day = (report: DwpReport) => (report.date.$date as string).slice(0, 10)
    return reports.filter((report) => {
      const on = day(report)
      // Both ends inclusive, as routes/filtering.py has them.
      if (period.low && on < period.low) return false
      if (period.high && on > period.high) return false
      return true
    })
  }, [reports, period.active, period.low, period.high])

  // Snapped back during render rather than reset in an effect, as the Topics card does:
  // a narrowed list is a different list, and page 3 of it is not page 3 of the whole.
  const start = offset < shown.length ? offset : 0
  const slice = shown.slice(start, start + ROWS_PER_PAGE)

  return (
    <Card
      title="Session history"
      controls={
        <DateRangeFilter column="date" label="session date" standalone range={period} />
      }
      flush
    >
      {reports.length === 0 ? (
        <p className="state">No sessions recorded for this student.</p>
      ) : shown.length === 0 ? (
        // Distinct from the line above: this student has sessions, just none in the
        // window asked for, and saying "no sessions recorded" would be wrong.
        <p className="state">No sessions in this period.</p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Instructor</th>
                  <th>Center</th>
                  <th className="numeric">Pages</th>
                  <th className="numeric">Mathlete</th>
                  <th className="numeric">Topics</th>
                  <th>Status</th>
                  {/* No heading: the buttons under it say what they do. */}
                  <th aria-label="Open report" />
                </tr>
              </thead>
              <tbody>
                {slice.map((report) => {
                  const id = report._id.$oid
                  const isOpen = expanded === id
                  const hasDetail = Boolean(
                    report.session_summary_notes?.trim() ||
                      report.student_notes?.trim() ||
                      report.assessment?.trim() ||
                      report.topics?.length,
                  )

                  return (
                    <Fragment key={id}>
                      <tr
                        className={
                          hasDetail
                            ? isOpen
                              ? 'row-expandable row-open'
                              : 'row-expandable'
                            : undefined
                        }
                        // Says the row is open to anything that is not looking at the
                        // colour, and is what lets a test ask for the selected row by
                        // role rather than by class name.
                        aria-expanded={hasDetail ? isOpen : undefined}
                        onClick={() => hasDetail && setExpanded(isOpen ? null : id)}
                      >
                        <td className="primary-name">{formatDate(report.date)}</td>
                        <td className="muted">{timeRange(report)}</td>
                        <td>
                          {report.instructors?.length ? (
                            report.instructors.map((name, index) => (
                              <Fragment key={name}>
                                {index > 0 && ', '}
                                {/* stopPropagation because the row itself toggles the
                                    expander: without it, following the link would also
                                    open a panel on the page being navigated away from. */}
                                <Link
                                  className="row-link"
                                  to={`/instructors/${encodeURIComponent(name)}`}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  {name}
                                </Link>
                              </Fragment>
                            ))
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          {report.centers?.[0] ? (
                            <span className="tag">{report.centers[0]}</span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        {/* Completed against the goal set for that session -- one number
                            alone does not say whether it was a good session. */}
                        <td className="numeric">
                          {report.pages_completed ?? '—'}
                          <span className="muted"> / {report.session_page_goal ?? '—'}</span>
                        </td>
                        <td className="numeric">
                          {report.mathlete_score ?? <span className="muted">—</span>}
                        </td>
                        <td className="numeric">{formatNumber(report.topics?.length ?? 0)}</td>
                        <td>
                          {/* Unfinalized means the instructor never completed the report.
                              The student still attended -- see the attendance panel. */}
                          {report.finalized ? (
                            <span className="muted">Finalized</span>
                          ) : (
                            <span className="tag tag-warn">Unfinalized</span>
                          )}
                        </td>
                        <td>
                          {/* The same button the reports list carries, so one report has
                              one page reached the same way from either table. On every
                              row, including the ones with nothing to expand. */}
                          <Link
                            className="button button-row"
                            to={`/reports/${id}`}
                            aria-label={`Open the ${formatDate(report.date)} report`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            Open
                          </Link>
                        </td>
                      </tr>

                      {isOpen && (
                        <tr className="row-detail row-open-detail">
                          <td colSpan={9}>
                            <Note label="Session summary" value={report.session_summary_notes} />
                            {/* Staff commentary about a named child: labelled so it is
                                never mistaken for parent-facing copy. */}
                            <Note label="Student notes" value={report.student_notes} internal />
                            <Note label="Assessment" value={report.assessment} />
                            {report.topics && report.topics.length > 0 && (
                              <div className="note">
                                <span className="note-label">Topics worked</span>
                                <div className="topic-pills">
                                  {report.topics.map((topic) => (
                                    <span key={topic.id} className="tag">
                                      {topic.name} · {topic.status}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          <Pager
            page={{
              limit: ROWS_PER_PAGE,
              offset: start,
              // The filtered total, not the student's: a pager counting rows the table is
              // not showing would say "1-25 of 149" over three.
              total: shown.length,
              returned: slice.length,
            }}
            onChange={(next) => {
              setOffset(next)
              // An expanded row on the page you just left would otherwise reopen when you
              // page back to it, having scrolled somewhere unrelated in between.
              setExpanded(null)
            }}
          />
        </>
      )}
    </Card>
  )
}
