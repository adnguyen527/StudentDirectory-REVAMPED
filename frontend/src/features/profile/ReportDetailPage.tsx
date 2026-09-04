import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'

import { formatDate, formatNumber, formatTime } from '../../api/bson'
import { getReport } from '../../api/endpoints'
import { decodeEntities } from '../../api/text'
import type { ReportDetail, ReportDetailResponse } from '../../api/types'
import { useApi } from '../../hooks/useApi'
import { timeRange } from '../timeRange'
import { Card } from '../../shell/Card'
import { CardRow } from '../../shell/CardRow'
import { ChevronIcon, DashboardIcon, StudentsIcon, TopicsIcon } from '../../shell/Icons'
import { StatTile } from '../../shell/StatTile'
import { useDocumentTitle } from '../../shell/useDocumentTitle'
import './Profile.css'

/**
 * How this page says a value is missing, in one place.
 *
 * Both the fields and the notes draw from it: a page that dashed one and wrote a sentence
 * for the other would be spelling the same fact two ways in two cards.
 */
const EMPTY = <span className="muted">—</span>

/** Nothing was recorded, as against a value that happens to be `false`. */
function isBlank(value: unknown) {
  return value === null || value === undefined || value === '' ||
    (Array.isArray(value) && value.length === 0)
}

interface FieldProps {
  label: string
  value: string | number | boolean | string[] | null | undefined
  children?: ReactNode
}

/**
 * One labelled value, always rendered.
 *
 * ⚠️ The page shows every field whether or not the report has one, so an empty field is a
 * muted dash in its usual place rather than a section that silently is not there. Which is
 * why `false` cannot take that path: last_punch_of_day and the two deck flags are on 100%
 * of reports and are usually false, and a false gone blank would read as "we don't know"
 * instead of "no". Booleans answer Yes or No; only a genuine gap dashes.
 */
function Field({ label, value, children }: FieldProps) {
  let shown: ReactNode
  if (children !== undefined) shown = children
  else if (typeof value === 'boolean') shown = value ? 'Yes' : 'No'
  else if (isBlank(value)) shown = EMPTY
  else if (Array.isArray(value)) shown = value.join(', ')
  else shown = value

  return (
    <div className="report-field">
      <span className="report-field-label">{label}</span>
      <span className="report-field-value">{shown}</span>
    </div>
  )
}

/** One block of prose, or the same slot left empty -- as a field with no value. */
function NoteBlock({
  label,
  value,
  internal,
}: {
  label: string
  value: string | null
  internal?: boolean
}) {
  return (
    <div className="note">
      <span className={internal ? 'note-label note-label-internal' : 'note-label'}>{label}</span>
      {value?.trim() ? (
        // The exports encode emoji as HTML character references, so a tenth of these notes
        // would otherwise end in a literal "&#128218;". Decoded to text, still escaped.
        <p className="note-body">{decodeEntities(value)}</p>
      ) : (
        <p className="note-body">{EMPTY}</p>
      )}
    </div>
  )
}

/** "3 / 5", or a dash when the report never recorded the figure. */
function ratio(done: number | null, goal: number | null) {
  if (done === null && goal === null) return '—'
  return `${done ?? '—'} / ${goal ?? '—'}`
}

/**
 * 1 -> "1st", 3 -> "3rd", 11 -> "11th", 21 -> "21st". Null stays null, so Field dashes it.
 *
 * ⚠️ The 11/12/13 exception is why this is a function rather than a lookup on the last
 * digit -- "11st" is the bug it guards. Not hypothetical: the field reaches 25 in the data,
 * so the teens and the twenties are both live.
 */
function ordinal(n: number | null) {
  if (n === null || n === undefined) return null
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/** The session's own length, which is not stored -- only its two ends are. */
function durationMinutes(report: ReportDetail) {
  if (!report.session_start || !report.session_end) return null
  const start = Date.parse(report.session_start.$date as string)
  const end = Date.parse(report.session_end.$date as string)
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  return Math.round((end - start) / 60000)
}

/**
 * One session, whole.
 *
 * The list's expander is the quick peek -- topics and the notes, on the 93% of reports that
 * have any. This is the record: every field the import writes, in a fixed order, whether or
 * not this particular session filled it in. Two reports side by side therefore differ only
 * in their content, and "no card level" is an answer you can read rather than a section you
 * have to notice is missing.
 *
 * ⚠️ Unlike the list, this serves student_notes -- models/dwp_report.py, DETAIL_PROJECTION.
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

  const minutes = durationMinutes(report)

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
          <span className="tag profile-center">{formatDate(report.date)}</span>
          <span className="muted">{timeRange(report)}</span>
          {report.centers[0] && <span className="tag profile-center">{report.centers[0]}</span>}
          {report.delivery_method && (
            <span className="tag profile-center">{report.delivery_method}</span>
          )}
          {report.finalized ? (
            <span className="muted">Finalized</span>
          ) : (
            <span className="tag tag-warn">Unfinalized</span>
          )}
        </p>
      </div>

      <div className="tile-row">
        <StatTile
          label="Pages completed"
          value={ratio(report.pages_completed, report.session_page_goal)}
          sub="against the goal set for the session"
          icon={<DashboardIcon size={22} />}
          wash={1}
        />
        <StatTile
          label="Mathlete score"
          // Null on 43.8% of reports. A dash, not a zero -- zero is a score.
          value={report.mathlete_score === null ? '—' : formatNumber(report.mathlete_score)}
          icon={<DashboardIcon size={22} />}
          wash={2}
        />
        <StatTile
          label="Topics worked"
          value={formatNumber(report.topics?.length ?? 0)}
          icon={<TopicsIcon size={22} />}
          wash={3}
        />
        <StatTile
          label="Session length"
          value={minutes === null ? '—' : `${formatNumber(minutes)} min`}
          // 0.7% of sessions have a start and no end, so there is nothing to subtract.
          sub={minutes === null ? 'no end time recorded' : undefined}
          icon={<StudentsIcon size={22} />}
          wash={4}
        />
      </div>

      <CardRow>
        <Card title="Notes">
          <NoteBlock label="Session summary" value={report.session_summary_notes} />
          {/* Staff commentary about a named child: labelled so it is never mistaken for
              parent-facing copy. The list route does not send this at all. */}
          <NoteBlock label="Student notes" value={report.student_notes} internal />
          <NoteBlock label="Assessment" value={report.assessment} />
        </Card>

        <Card title="Topics worked" flush>
          {report.topics && report.topics.length > 0 ? (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Topic</th>
                    <th>Id</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {report.topics.map((topic) => (
                    <tr key={topic.id}>
                      <td className="primary-name">{topic.name}</td>
                      <td>
                        <Link className="row-link" to={`/topics/${encodeURIComponent(topic.id)}`}>
                          {topic.id}
                        </Link>
                      </td>
                      <td>
                        <span className="tag">{topic.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="state">No topics recorded on this session.</p>
          )}
        </Card>
      </CardRow>

      <Card title="Session details">
        <div className="report-fields">
          <Field label="Instructors" value={report.instructors}>
            {report.instructors.length > 0 ? (
              report.instructors.map((name, index) => (
                <span key={name}>
                  {index > 0 && ', '}
                  <Link className="row-link" to={`/instructors/${encodeURIComponent(name)}`}>
                    {name}
                  </Link>
                </span>
              ))
            ) : (
              // 73 sessions named an instructor who does not exist; ingestion drops the
              // name rather than inventing a person -- see PLACEHOLDER_INSTRUCTORS.
              <span className="muted">—</span>
            )}
          </Field>
          <Field label="Center" value={report.centers} />
          <Field label="Operating as" value={report.center_orgs} />
          <Field label="Delivery" value={report.delivery_method} />

          {/* ⚠️ Not a total for the month. The value is this session's own position
              within its calendar month, counted up to and including itself, and it runs
              per student rather than per household -- siblings on one account each keep
              their own. A label reading "Sessions this month" claimed the opposite. */}
          <Field
            label="Session of the month"
            value={ordinal(report.sessions_this_month)}
          />
          <Field label="Last punch of the day" value={report.last_punch_of_day} />
          <Field label="Report finalized" value={report.finalized} />
          <Field
            label="Finalized on"
            value={report.finalized_date ? formatDate(report.finalized_date) : null}
          />

          <Field label="Primary deck needs update" value={report.needs_primary_deck_update} />
          <Field label="Primary deck next page" value={report.primary_deck_next_page} />
          <Field label="Secondary deck needs update" value={report.needs_secondary_deck_update} />
          <Field label="Secondary deck next page" value={report.secondary_deck_next_page} />

          <Field label="Card level" value={report.card_level} />
          <Field
            label="Stars on card"
            value={
              report.stars_current === null && report.stars_max === null
                ? null
                : ratio(report.stars_current, report.stars_max)
            }
          />
          <Field label="Stars added this session" value={report.session_stars_added} />

          <Field label="Schoolwork completed" value={report.schoolwork_completed} />
          <Field label="Schoolwork checked" value={report.schoolwork_checked} />
          <Field label="Schoolwork started" value={report.schoolwork_start_time} />
          <Field
            label="Schoolwork duration"
            value={
              report.schoolwork_duration_min === null
                ? null
                : `${formatNumber(report.schoolwork_duration_min)} min`
            }
          />
          <Field label="Schoolwork" value={report.schoolwork_description} />

          <Field label="Goal 1" value={report.student_goal1} />
          <Field label="Goal 2" value={report.student_goal2} />
          <Field label="Goal 3" value={report.student_goal3} />

          <Field label="Internet rating" value={report.internet_rating} />
          <Field
            label="Session start"
            value={report.session_start ? formatTime(report.session_start) : null}
          />
          <Field
            label="Session end"
            value={report.session_end ? formatTime(report.session_end) : null}
          />
        </div>
      </Card>
    </div>
  )
}
