import { Link, useSearchParams } from 'react-router-dom'

import { formatDate, formatNumber } from '../../api/bson'
import { getReportQuality } from '../../api/endpoints'
import type { QualityResponse } from '../../api/types'
import { BarChart } from '../../charts/BarChart'
import { useApi } from '../../hooks/useApi'
import { AsyncBoundary } from '../../shell/AsyncBoundary'
import { Card } from '../../shell/Card'
import { useDocumentTitle } from '../../shell/useDocumentTitle'
import { CenterBar } from '../centers/CenterBar'
import { CHECK_ORDER, checkCopy } from './checks'

/**
 * What is missing or contradictory in the report data right now.
 *
 * ⚠️ **Current state, not an import audit.** These say what is wrong with the collection
 * today, which is what can be acted on. What a particular import run did -- which rows it
 * skipped, from which file, when -- is not recorded anywhere and cannot be reconstructed
 * here; that waits on the `import_runs` collection in the TODO. `ambiguous_keys` is the one
 * that looks like history and is not: the colliding documents are still stored, so the
 * condition is findable even though the event that created it was never written down.
 *
 * Counts only, and deliberately. Every row behind these numbers is about a named child, so
 * the endpoint returns no examples and this page shows none.
 */
export function DataQualityPage() {
  useDocumentTitle('Data Quality')
  const [params] = useSearchParams()
  const centers = params.getAll('center').filter(Boolean)
  const centerKey = centers.join('|')

  const { data, loading, error } = useApi<QualityResponse>(
    (signal) => getReportQuality({ centers }, signal),
    [centerKey],
  )

  const total = data?.total ?? 0
  // The API's order is its own; this page reads actionable-first. A key the API grew that
  // this list has not caught up with is appended rather than dropped -- a monitoring page
  // that silently omits a check is worse than one showing an unfamiliar name.
  const known = new Set(CHECK_ORDER)
  const checks = data
    ? [
        ...CHECK_ORDER.map((key) => data.checks.find((check) => check.key === key)).filter(
          (check) => check !== undefined,
        ),
        ...data.checks.filter((check) => !known.has(check.key)),
      ]
    : []

  return (
    <div className="page">
      <div className="page-header">
        <h1>Data Quality</h1>
        <p>
          {data
            ? `${formatNumber(total)} reports checked. Counts only — every row behind these is about a named student.`
            : 'What is missing or contradictory in the report data.'}
        </p>
      </div>

      <CenterBar />

      {error ? (
        <div className="state-error" role="alert">
          <strong>{error.status ? `Error ${error.status}` : 'Cannot reach the API'}</strong>
          {error.displayMessage}
        </div>
      ) : (
        <>
          <div className="quality-cards">
            {checks.map((check) => {
              const copy = checkCopy(check.key)
              return (
                <Card key={check.key} title={copy.label} showOverflow={false}>
                  <p className={check.count > 0 ? 'quality-figure' : 'quality-figure quality-clear'}>
                    {loading && !data ? '—' : formatNumber(check.count)}
                    {/* The denominator, because 5,945 alone means nothing. */}
                    {total > 0 && !loading && (
                      <span className="muted quality-of"> of {formatNumber(total)}</span>
                    )}
                  </p>
                  <p className="muted quality-detail">{copy.detail}</p>
                </Card>
              )
            })}
          </div>

          <Card title="Checks at a glance" showOverflow={false}>
            <AsyncBoundary loading={loading && !data} error={null}>
              <BarChart
                caption="Reports failing each check"
                valueLabel="Reports"
                data={checks.map((check) => ({
                  key: check.key,
                  label: checkCopy(check.key).label,
                  value: check.count,
                }))}
                note={
                  // ⚠️ Not a breakdown: one report can fail several of these at once -- an
                  // unfinalized report has no page count either -- so the bars overlap and
                  // do not add up to the total.
                  'A report can fail more than one check, so these bars overlap and do not add up to the total.'
                }
              />
            </AsyncBoundary>
          </Card>

          <Card title="Ambiguous natural keys" showOverflow={false} flush>
            <AsyncBoundary
              loading={loading && !data}
              error={null}
              empty={data !== null && data.ambiguous_keys.length === 0}
              emptyMessage="No two reports share a natural key. Every row can still be updated by an import."
            >
              <p className="quality-detail muted table-inset">
                Student-days where more than one report shares the same account, name, date and
                start time. An import cannot tell which of them a source row means, so it reports
                the key and skips it — these are the rows an import can no longer update.
              </p>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      <th>Date</th>
                      <th>Start</th>
                      <th className="numeric">Reports</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.ambiguous_keys.map((key) => (
                      <tr key={`${key.account_id}|${key.student_name}|${key.date.$date}`}>
                        <td>
                          {/* ⚠️ Linked by search rather than by a key built here. The
                              student_key is account_id + a slug of the name, derived on the
                              server (routes/reports.py, _with_student_key); spelling it
                              again in the browser would be a second source of truth for a
                              routing key, and a wrong one links to a profile that does not
                              exist. */}
                          <Link
                            className="row-link"
                            to={`/students?query=${encodeURIComponent(key.student_name)}`}
                          >
                            {key.student_name}
                          </Link>
                        </td>
                        <td>{formatDate(key.date)}</td>
                        <td>{key.session_start ? formatDate(key.session_start) : '—'}</td>
                        <td className="numeric">{formatNumber(key.documents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </AsyncBoundary>
          </Card>

          <p className="muted table-footnote">
            {/* Said plainly rather than shown as links that do not work. The reports list
                filters on student, centre and date only, so "the 1,068 unfinalized reports"
                is not yet a view it can express -- that waits on the P3 finalized filter. */}
            These counts are not yet clickable. The reports list can be filtered by student,
            centre and date, but not by whether a report is finalized or what it is missing,
            so there is no view to link a card to.
          </p>
        </>
      )}
    </div>
  )
}
