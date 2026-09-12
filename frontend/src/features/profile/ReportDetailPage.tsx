import { Link, useParams } from 'react-router-dom'

import { formatDate } from '../../api/bson'
import { getReport } from '../../api/endpoints'
import type { ReportDetailResponse } from '../../api/types'
import { useApi } from '../../hooks/useApi'
import { Card } from '../../shell/Card'
import { ChevronIcon } from '../../shell/Icons'
import { useDocumentTitle } from '../../shell/useDocumentTitle'
import { ReportChips, ReportDetailBody } from './ReportDetailBody'
import './Profile.css'

/**
 * One session, at its own address.
 *
 * What is here is what only a page has: the id from the URL, the document title, the two
 * failure states, and the way back to the list. The record itself lives in
 * ReportDetailBody, which the center dashboard's modal renders from the same data -- so a
 * field added there appears in both without anyone remembering to add it twice.
 */
export function ReportDetailPage() {
  const { reportId = '' } = useParams()

  const { data, loading, error } = useApi<ReportDetailResponse>(
    (signal) => getReport(reportId, signal),
    [reportId],
  )

  const report = data?.report

  // Named for the record, not the route: a row of tabs and the Back menu are only useful
  // if they say which student. Null while it loads, so the previous title holds rather
  // than flashing the wordmark between two real names.
  useDocumentTitle(
    error?.status === 404
      ? 'Report not found'
      : report
        ? `Session: ${report.student_name}, ${formatDate(report.date)}`
        : null,
  )

  if (error?.status === 404) {
    return (
      <div className="page">
        <Card title="Report not found" showOverflow={false}>
          <p className="muted">
            No report with the id <code>{reportId}</code>.
          </p>
          <p className="profile-back-block">
            <Link className="button" to="/reports">
              Back to all reports
            </Link>
          </p>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page">
        <div className="state-error" role="alert">
          <strong>{error.status ? `Error ${error.status}` : 'Cannot reach the API'}</strong>
          {error.displayMessage}
        </div>
      </div>
    )
  }

  if (loading || !report) {
    return (
      <div className="page">
        <p className="state">Loading report…</p>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <Link className="profile-back" to="/reports">
          <ChevronIcon className="profile-back-icon" />
          All reports
        </Link>
        {/* The student names the session; the date and time say which one. */}
        <h1>
          <Link className="row-link" to={`/students/${encodeURIComponent(report.student_key)}`}>
            {report.student_name}
          </Link>
        </h1>
        <p>
          <ReportChips report={report} />
        </p>
      </div>

      <ReportDetailBody report={report} />
    </div>
  )
}
