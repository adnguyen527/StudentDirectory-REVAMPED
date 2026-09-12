import { Link } from 'react-router-dom'

import { getReport } from '../../api/endpoints'
import type { ReportDetailResponse } from '../../api/types'
import { useApi } from '../../hooks/useApi'
import { AsyncBoundary } from '../../shell/AsyncBoundary'
import { Modal } from '../../shell/Modal'
import { ReportChips, ReportDetailBody } from '../profile/ReportDetailBody'

/**
 * One session opened over the dashboard that listed it.
 *
 * ⚠️ It fetches the report again rather than reusing the row the table already has. The
 * list route withholds `student_notes` by projection -- models/dwp_report.py -- so a modal
 * built from a list row would render the notes block empty and look like a child with
 * nothing recorded, which is the one reading that must not be possible.
 *
 * The record is ReportDetailBody, the same component /reports/:id renders, so the modal
 * and the page cannot come to show different things about one session.
 */
export function ReportModal({ reportId, onClose }: { reportId: string; onClose: () => void }) {
  const { data, loading, error } = useApi<ReportDetailResponse>(
    (signal) => getReport(reportId, signal),
    [reportId],
  )

  const report = data?.report

  return (
    <Modal
      title={
        report ? (
          // Still a link: the modal is a peek at one session, and the student behind it is
          // where a manager goes next. Navigating away closes the dialog with the page.
          <Link className="row-link" to={`/students/${encodeURIComponent(report.student_key)}`}>
            {report.student_name}
          </Link>
        ) : (
          'Session'
        )
      }
      subtitle={report && <ReportChips report={report} />}
      onClose={onClose}
    >
      <AsyncBoundary loading={loading} error={error}>
        {report && <ReportDetailBody report={report} />}
      </AsyncBoundary>
    </Modal>
  )
}
