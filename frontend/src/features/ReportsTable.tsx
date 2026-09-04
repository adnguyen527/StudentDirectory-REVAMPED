import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'

import { formatDate, formatNumber } from '../api/bson'
import type { ReportListItem } from '../api/types'
import { Note } from './profile/SessionHistoryCard'
import { ColumnHeader } from './SortHeader'
import { timeRange } from './timeRange'
import './profile/Profile.css'

/** Date, Time, Student, Instructor, Center, Pages, Mathlete, Topics, Status, Open. */
const COLUMN_COUNT = 10

interface ReportsTableProps {
  reports: ReportListItem[]
  sortable?: boolean
}

/**
 * Every session report, across every student -- the columns of the Session history card on
 * a student profile, plus the student.
 *
 * Deliberately the same row: someone who has read one student's sessions should not have to
 * learn a second table to read the whole program's. What differs is what the row is *for*.
 * On a profile the student is the context and the date is the handle; here the student is
 * the answer, so it is a link out and the instructor beside it is one too.
 *
 * ⚠️ No student notes. The list route does not send them -- models/dwp_report.py,
 * LIST_PROJECTION -- so this expander shows the session summary, the assessment and the
 * topics, and the profile stays the only place the notes are read.
 *
 * Only Date and Student are sortable, matching SORTABLE on the model. Pages and mathlete
 * score are null on unfinalized reports and would need the nulls-last treatment Topic._page
 * carries before they could be ordered honestly.
 */
export function ReportsTable({ reports, sortable }: ReportsTableProps) {
  const [expanded, setExpanded] = useState<string | null>(null)

  // A row expanded on the page you just left must not reopen when you come back to it,
  // having scrolled somewhere unrelated in between -- SessionHistoryCard clears the same
  // state on paging, but there the pager is its own. Here the page above owns the offset,
  // so the first row changing is what says these are different rows. Adjusted during
  // render rather than in an effect, the idiom DateRangeFilter uses.
  const firstId = reports[0]?._id.$oid ?? null
  const [pageMark, setPageMark] = useState(firstId)
  if (pageMark !== firstId) {
    setPageMark(firstId)
    setExpanded(null)
  }

  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <ColumnHeader sortable={sortable} column="date" first="desc">
              Date
            </ColumnHeader>
            <th>Time</th>
            <ColumnHeader sortable={sortable} column="student" first="asc">
              Student
            </ColumnHeader>
            <th>Instructor</th>
            <th>Center</th>
            <th className="numeric">Pages</th>
            <th className="numeric">Mathlete</th>
            <th className="numeric">Topics</th>
            <th>Status</th>
            {/* No heading: the buttons under it say what they do, and a column called
                "Open" would be read out before every one of them. */}
            <th aria-label="Open report" />
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => {
            const id = report._id.$oid
            const isOpen = expanded === id
            const hasDetail = Boolean(
              report.session_summary_notes?.trim() ||
                report.assessment?.trim() ||
                report.topics?.length,
            )

            return (
              <Fragment key={id}>
                <tr
                  className={
                    hasDetail ? (isOpen ? 'row-expandable row-open' : 'row-expandable') : undefined
                  }
                  // Says the row is open to anything that is not looking at the colour --
                  // as SessionHistoryCard.
                  aria-expanded={hasDetail ? isOpen : undefined}
                  onClick={() => hasDetail && setExpanded(isOpen ? null : id)}
                >
                  <td>{formatDate(report.date)}</td>
                  <td className="muted">{timeRange(report)}</td>
                  <td className="primary-name">
                    {/* stopPropagation because the row itself toggles the expander:
                        without it, following the link would also open a panel on the page
                        being navigated away from. */}
                    <Link
                      className="row-link"
                      to={`/students/${encodeURIComponent(report.student_key)}`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {report.student_name}
                    </Link>
                  </td>
                  <td>
                    {report.instructors?.length ? (
                      report.instructors.map((name, index) => (
                        <Fragment key={name}>
                          {index > 0 && ', '}
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
                      // Not a gap in the data so much as a fact about the row: 73 sessions
                      // named an instructor who does not exist, and ingestion drops the
                      // name rather than inventing one -- see PLACEHOLDER_INSTRUCTORS.
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
                  {/* Completed against the goal set for that session -- one number alone
                      does not say whether it was a good session. */}
                  <td className="numeric">
                    {report.pages_completed ?? '—'}
                    <span className="muted"> / {report.session_page_goal ?? '—'}</span>
                  </td>
                  <td className="numeric">
                    {report.mathlete_score ?? <span className="muted">—</span>}
                  </td>
                  <td className="numeric">{formatNumber(report.topics?.length ?? 0)}</td>
                  <td>
                    {/* Unfinalized means the instructor never completed the report. The
                        student still attended. */}
                    {report.finalized ? (
                      <span className="muted">Finalized</span>
                    ) : (
                      <span className="tag tag-warn">Unfinalized</span>
                    )}
                  </td>
                  <td>
                    {/* On every row, not only the ones with something to expand: 7% of
                        reports have no topics, summary or assessment, and those are
                        exactly the rows the expander leaves inert. stopPropagation
                        because the row toggles that expander -- without it, leaving the
                        page also opens a panel on the row behind you. The date is in the
                        accessible name: fifty buttons all called "Open" are fifty
                        identical items in a screen reader's list. */}
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
                    <td colSpan={COLUMN_COUNT}>
                      <Note label="Session summary" value={report.session_summary_notes} />
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
  )
}
