import { Fragment, useState } from 'react'

import { formatDate, formatNumber, formatTime } from '../../api/bson'
import { decodeEntities } from '../../api/text'
import type { DwpReport } from '../../api/types'
import { Card } from '../../shell/Card'
import { Pager } from '../../shell/Pager'
import './Profile.css'

const ROWS_PER_PAGE = 25

/** "5:53 PM – 6:53 PM", or just the start. Sessions without an end are 0.7% of the data. */
function timeRange(report: DwpReport): string {
  if (!report.session_start) return '—'
  const start = formatTime(report.session_start)
  return report.session_end ? `${start} – ${formatTime(report.session_end)}` : start
}

/** One labelled block of prose, or nothing at all -- never an empty labelled section. */
function Note({ label, value, internal }: { label: string; value: string | null; internal?: boolean }) {
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

  const slice = reports.slice(offset, offset + ROWS_PER_PAGE)

  return (
    <Card title="Session history" flush>
      {reports.length === 0 ? (
        <p className="state">No sessions recorded for this student.</p>
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
                        className={hasDetail ? 'row-expandable' : undefined}
                        onClick={() => hasDetail && setExpanded(isOpen ? null : id)}
                      >
                        <td className="primary-name">{formatDate(report.date)}</td>
                        <td className="muted">{timeRange(report)}</td>
                        <td>{report.instructors?.join(', ') || <span className="muted">—</span>}</td>
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
                      </tr>

                      {isOpen && (
                        <tr className="row-detail">
                          <td colSpan={8}>
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
              offset,
              total: reports.length,
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
