import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { formatDate, formatNumber } from '../../api/bson'
import { getTopic } from '../../api/endpoints'
import type { TopicDetailResponse } from '../../api/types'
import { useApi } from '../../hooks/useApi'
import { Card } from '../../shell/Card'
import { CardRow } from '../../shell/CardRow'
import { ChevronIcon, DashboardIcon, StudentsIcon } from '../../shell/Icons'
import { Pager } from '../../shell/Pager'
import { StatTile } from '../../shell/StatTile'
import { useDocumentTitle } from '../../shell/useDocumentTitle'
import './Profile.css'

/** The median topic has 17 instructors and the widest 82 -- 62% need more than one page. */
const INSTRUCTOR_PAGE = 10

/**
 * One topic across the whole program: how hard it is, and who teaches it.
 *
 * Every count here is per (student, topic) pair rather than per session -- a student who
 * worked a topic across nine sessions counts once. See ingestion/build_topics.py.
 */
/** One labelled figure, with the caveat that makes it readable under it. */
function Field({
  label,
  value,
  note,
}: {
  label: string
  value: string | null
  note?: string
}) {
  return (
    <div className="report-field">
      <span className="report-field-label">{label}</span>
      <span className="report-field-value">{value ?? <span className="muted">—</span>}</span>
      {note && <span className="topic-field-note">{note}</span>}
    </div>
  )
}

export function TopicProfilePage() {
  const { topicId = '' } = useParams()
  const [instructorOffset, setInstructorOffset] = useState(0)

  const { data, loading, error } = useApi<TopicDetailResponse>(
    (signal) => getTopic(topicId, signal),
    [topicId],
  )

  const topic = data?.topic

  // Named for the record, not the route, so a row of tabs and the Back menu say which
  // topic. Null while it loads, so the previous title holds rather than flashing the
  // wordmark between two real names.
  //
  // The id leads: 90 names are carried by more than one topic and four are called
  // "Patterns - Number Patterns", so the name alone can name two different tabs the same
  // thing -- and the front of the string is the half that survives a narrow one.
  useDocumentTitle(
    error?.status === 404 ? 'Topic not found' : topic ? `${topic.topic_id} ${topic.name}` : null,
  )

  if (error?.status === 404) {
    return (
      <div className="page">
        <Card title="Topic not found" showOverflow={false}>
          <p className="muted">
            No topic with the id <code>{topicId}</code>.
          </p>
          <p className="profile-back-block">
            <Link className="button" to="/topics">
              Back to all topics
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

  if (loading || !topic) {
    return (
      <div className="page">
        <p className="state">Loading topic…</p>
      </div>
    )
  }

  // "Ever" against "now". A topic finished and later handed back sits in students_on_plan
  // while still counting in students_ever_finished, so the two disagreeing is expected
  // rather than a bug -- worth saying on screen where it happens.
  const handedBack = topic.students_ever_finished - topic.students_finished

  // One element serves topics/:topicId, so React reconciles rather than remounts when the
  // id changes and the offset survives the move. Snapping back here rather than resetting
  // in an effect keeps it to one render pass; without it, leaving page 8 of an
  // 82-instructor topic for a three-instructor one lands on an empty "71-80 of 3".
  const offset = instructorOffset < topic.instructors.length ? instructorOffset : 0
  const shownInstructors = topic.instructors.slice(offset, offset + INSTRUCTOR_PAGE)

  return (
    <div className="page">
      <div className="page-header">
        <Link className="profile-back" to="/topics">
          <ChevronIcon className="profile-back-icon" />
          All topics
        </Link>
        <h1>{topic.name}</h1>
        <p>
          <span className="tag profile-center">{topic.topic_id}</span>
          {/* The source spells three topics two ways. Shown rather than hidden: someone
              who knows the old name needs to see they are in the right place. */}
          {topic.also_known_as.map((name) => (
            <span key={name} className="tag profile-center">
              also “{name}”
            </span>
          ))}
        </p>
      </div>

      <div className="tile-row">
        <StatTile
          label="Students"
          value={formatNumber(topic.unique_students)}
          sub={`${formatNumber(topic.sessions)} sessions worked`}
          icon={<StudentsIcon size={22} />}
          wash={1}
        />
        <StatTile
          label="Finished it"
          value={formatNumber(topic.students_finished)}
          sub={
            handedBack > 0
              ? `${formatNumber(handedBack)} finished it once, then got it back`
              : undefined
          }
          icon={<DashboardIcon size={22} />}
          wash={2}
        />
        <StatTile
          label="Median sessions to finish"
          // Null is the answer for a topic nobody has finished, not a zero.
          value={
            topic.median_sessions_to_finish === null
              ? '—'
              : formatNumber(topic.median_sessions_to_finish)
          }
          sub={
            topic.median_sessions_to_finish === null ? 'nobody has finished it' : undefined
          }
          icon={<DashboardIcon size={22} />}
          wash={3}
        />
        <StatTile
          label="Reassignments"
          value={formatNumber(topic.total_reassignments)}
          sub="times it went back on a plan"
          icon={<DashboardIcon size={22} />}
          wash={4}
        />
      </div>
          <Card title="Time to finish and page pace" showOverflow={false}>
              <div className="report-fields">
                  {/* Median leads on both. The mean days to finish is 26.7 against a median of 13,
                  with a 393-day tail -- a mean alone describes almost nobody. The mean sessions
                  sits beside its median rather than replacing it. */}
                  <Field
                      label="Sessions to finish"
                      value={
                          topic.median_sessions_to_finish === null
                              ? null
                              : `${formatNumber(topic.median_sessions_to_finish)} median` +
                              (topic.mean_sessions_to_finish === null
                                  ? ''
                                  : ` · ${topic.mean_sessions_to_finish.toFixed(1)} mean`)
                      }
                  />
                  <Field
                      label="Days to finish"
                      value={
                          topic.median_days_to_finish === null
                              ? null
                              : `${formatNumber(topic.median_days_to_finish)} median`
                      }
                      note="From first sight to the finishing session, not from the last assignment."
                  />
                  <Field
                      label="Pages per session"
                      value={
                          topic.session_pages_ratio === null
                              ? null
                              : `${topic.session_pages_ratio.toFixed(2)}×`
                      }
                      note={
                          topic.session_pages_ratio === null
                              ? // Below the builder's threshold. Say why rather than showing a figure
                              // off a handful of sessions.
                              `Too few finalized sessions to compare — ${formatNumber(
                                  topic.session_pages_ratio_basis,
                              )} so far.`
                              : `Sessions including this topic, against each student's own pace, over ` +
                              `${formatNumber(topic.session_pages_ratio_basis)} sessions.`
                      }
                  />
                  {/* ⚠️ Shown beside the figure, because the figure is meaningless without it. A
                  session's pages count once for every topic on it, so the distribution sits
                  above 1.0: read against 1.0, 223 of 283 topics look like they speed students
                  up. Half the topics sit either side of this line. */}
                  <Field
                      label="Program median"
                      value={
                          topic.session_pages_ratio_median === null
                              ? null
                              : `${topic.session_pages_ratio_median.toFixed(2)}×`
                      }
                      note="What a typical topic does. The comparison point, not 1.00×."
                  />
              </div>
          </Card>
      {/* Side by side because they are the same three states counted two ways -- once
          per student, once per session -- and the difference between the two columns is
          the thing worth seeing. Stacked, you had to remember the first to read the
          second. */}
      <CardRow>
        <Card title="Where students stand" flush>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>State</th>
                  <th className="numeric">Students</th>
                </tr>
              </thead>
              <tbody>
                {/* These three are mutually exclusive and sum to unique_students: `state`
                    reads a student's last assignment only. The first is shown as a fraction
                    of its own count -- how many of the students who finished it got to
                    Mastered rather than stopping at Completed. */}
                <tr>
                  <td>Mastered</td>
                  <td className="numeric">
                    {topic.students_finished === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      `${formatNumber(topic.students_mastered)} / ${formatNumber(
                        topic.students_finished,
                      )}`
                    )}
                  </td>
                </tr>
                <tr>
                  <td>Still on the plan</td>
                  <td className="numeric">{formatNumber(topic.students_on_plan)}</td>
                </tr>
                <tr>
                  <td>Came off the plan unfinished</td>
                  <td className="numeric">{formatNumber(topic.students_removed)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="How sessions ended" flush>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th className="numeric">Sessions</th>
                </tr>
              </thead>
              <tbody>
                {/* The ladder, not three labels: Mastered implies Completed implies Worked
                    On. The source writes one status per session, so a topic mastered is
                    almost never also written as completed. */}
                <tr>
                  <td>Worked on</td>
                  <td className="numeric">{formatNumber(topic.times_worked_on)}</td>
                </tr>
                <tr>
                  <td>Completed</td>
                  <td className="numeric">{formatNumber(topic.times_completed)}</td>
                </tr>
                <tr>
                  <td>Mastered</td>
                  <td className="numeric">{formatNumber(topic.times_mastered)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </CardRow>

      <Card title={`Taught most by · ${formatNumber(topic.instructors.length)} instructors`} flush>
        {topic.instructors.length === 0 ? (
          <p className="state">
            No instructor was recorded on any session of this topic — incomplete paperwork
            rather than an unstaffed lesson.
          </p>
        ) : (
          <>
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Instructor</th>
                    <th className="numeric">Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {shownInstructors.map((instructor) => (
                    <tr key={instructor.name}>
                      <td className="primary-name">
                        <Link
                          className="row-link"
                          to={`/instructors/${encodeURIComponent(instructor.name)}`}
                        >
                          {instructor.name}
                        </Link>
                      </td>
                      <td className="numeric">{formatNumber(instructor.sessions)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* The whole ranked list is already in the detail payload -- 82 entries at the
                widest -- so this pages what is in hand rather than refetching. */}
            <Pager
              page={{
                limit: INSTRUCTOR_PAGE,
                offset,
                total: topic.instructors.length,
                returned: shownInstructors.length,
              }}
              onChange={setInstructorOffset}
            />
          </>
        )}
      </Card>
    </div>
  )
}
