// libraries & hooks
import { useSearchParams } from 'react-router-dom'
import { useApi } from '../../hooks/useApi'
// apis
import { formatNumber } from '../../api/bson'
import { getCenterMetrics } from '../../api/endpoints'
import type { CenterMetricsResponse } from '../../api/types'
// components
import {
  DashboardIcon,
  InstructorsIcon,
  ReportsIcon,
  StudentsIcon,
} from '../../shell/Icons'
import { StatTile } from '../../shell/StatTile'
import { useDocumentTitle } from '../../shell/useDocumentTitle'
import { CenterActivityCard } from './CenterActivityCard'
import { CenterBar } from './CenterBar'
import { CenterInstructorsCard } from './CenterInstructorsCard'
import { CenterSessionsCard } from './CenterSessionsCard'
import { CenterStudentsCard } from './CenterStudentsCard'
// styles
import './Centers.css'

/**
 * What a manager's centers come to.
 *
 * The selection lives in the URL as repeated `?center=`, so the page is linkable and every
 * card reads the same one list. Several centers are combined into one set of figures
 * rather than compared column by column -- a manager over three centers is asking what
 * their three come to.
 *
 * ⚠️ **The tiles are not the sum of the cards below them.** They are counted from
 * `dwp_reports`, where a session exists once. The instructor card's pages are per
 * instructor, and a co-taught session credits its pages to each of them in full -- adding
 * those up overshoots the real total by about ten percent. models/center.py has the long
 * version of why this page reads from two places on purpose.
 */
export function CenterMetricsPage() {
  useDocumentTitle('Center Metrics')
  const [params] = useSearchParams()
  const centers = params.getAll('center').filter(Boolean)
  const centerKey = centers.join('|')

  const { data, loading, error } = useApi<CenterMetricsResponse>(
    (signal) => getCenterMetrics(centers, signal),
    [centerKey],
  )

  const totals = data?.totals

  const heading =
    centers.length === 0
      ? 'All centers'
      : centers.length === 1
        ? centers[0]
        : `${centers.length} centers`

  return (
    <div className="page">
      <div className="page-header">
        <h1>Center Metrics</h1>
        <p>
          {heading}
          {totals ? ` · ${formatNumber(totals.sessions)} sessions all-time.` : '.'}
        </p>
      </div>

      <CenterBar />

      {error ? (
        <div className="state-error" role="alert">
          <strong>{error.status ? `Error ${error.status}` : 'Cannot reach the API'}</strong>
          {error.displayMessage}
        </div>
      ) : (
        <div className="tile-row" data-testid="tile-row">
          <StatTile
            label="Sessions"
            value={formatNumber(totals?.sessions)}
            // Days, not sessions: 70 student-days in the data carry more than one session,
            // so the two are different numbers and the sub-line says which is which.
            sub={totals ? `across ${formatNumber(totals.days)} days` : undefined}
            icon={<ReportsIcon size={22} />}
            wash={1}
            loading={loading}
          />
          <StatTile
            label="Students"
            value={formatNumber(totals?.students)}
            icon={<StudentsIcon size={22} />}
            wash={2}
            loading={loading}
          />
          <StatTile
            label="Instructors"
            value={formatNumber(totals?.instructors)}
            icon={<InstructorsIcon size={22} />}
            wash={3}
            loading={loading}
          />
          <StatTile
            label="Pages completed"
            value={formatNumber(totals?.pages_completed)}
            icon={<DashboardIcon size={22} />}
            wash={4}
            loading={loading}
          />
          <StatTile
            label="Unfinalized"
            // The one figure here that is a to-do list rather than a record.
            sub={totals?.unfinalized ? 'reports still to finalize' : undefined}
            value={formatNumber(totals?.unfinalized)}
            icon={<ReportsIcon size={22} />}
            wash={1}
            loading={loading}
          />
        </div>
      )}

      {/* Directly under the tiles, because it is the same five figures drawn over time and
          across centers rather than summed. It shares the sessions card's anchor for the
          same reason, and for its bucket width rather than its opening window -- this one
          opens on Any time. */}
      <CenterActivityCard
        centers={centers}
        lastSession={totals?.last_session ?? null}
        anchorLoading={loading}
      />

      {/* The card opens on the newest session day at these centers, which is why the
          anchor comes from the totals already fetched above rather than from a second
          request or from the dataset-wide /api/metrics. */}
      <CenterSessionsCard
        centers={centers}
        lastSession={totals?.last_session ?? null}
        anchorLoading={loading}
      />

      {/* Stacked rather than a CardRow of two. Seven numeric columns each do not fit in
          half the content width -- side by side, both tables clipped their Last session
          column behind a horizontal scrollbar, which is where the reader's eye goes last
          on a dashboard. */}
      <CenterStudentsCard centers={centers} />
      <CenterInstructorsCard centers={centers} />
    </div>
  )
}
