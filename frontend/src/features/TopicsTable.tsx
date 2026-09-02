import { Link } from 'react-router-dom'

import { formatNumber } from '../api/bson'
import type { TopicListItem } from '../api/types'

interface TopicsTableProps {
  topics: TopicListItem[]
}

/**
 * The topic list's columns, in one place -- as InstructorsTable.
 *
 * Counts, not rates. A finish *rate* column would rank the list misleadingly: the id
 * prefix predicts completion almost entirely -- PK, the curriculum proper, finishes 68.7%
 * while GF is 28.3% and WCH 13.0% -- so sorting by rate fills the bottom with items that
 * do not carry a completion status the same way and reads as "hardest topics". The id is
 * shown, which is also what makes that difference visible.
 *
 * Every figure is all-time: ingestion/build_topics.py batch-builds these and they carry
 * no period.
 */
export function TopicsTable({ topics }: TopicsTableProps) {
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Topic</th>
            <th className="numeric">Sessions</th>
            <th className="numeric">Students</th>
            <th className="numeric">Finished</th>
            <th className="numeric">On plan</th>
            <th className="numeric">Removed</th>
            <th className="numeric">Median sessions</th>
            <th className="numeric">Reassigned</th>
          </tr>
        </thead>
        <tbody>
          {topics.map((topic) => (
            <tr key={topic.topic_id}>
              <td className="primary-name">
                <Link className="row-link" to={`/topics/${encodeURIComponent(topic.topic_id)}`}>
                  {topic.name}
                </Link>
                {/* Not decoration: 90 names are carried by more than one topic and four
                    are called "Patterns - Number Patterns", so without the id those rows
                    read as duplicates of each other. */}
                <span className="row-sub">{topic.topic_id}</span>
              </td>
              <td className="numeric">{formatNumber(topic.sessions)}</td>
              <td className="numeric">{formatNumber(topic.unique_students)}</td>
              <td className="numeric">{formatNumber(topic.students_finished)}</td>
              <td className="numeric">{formatNumber(topic.students_on_plan)}</td>
              <td className="numeric">{formatNumber(topic.students_removed)}</td>
              {/* Null means nobody has finished it, which is an answer -- so a dash
                  rather than a zero, which would claim they finished it instantly. */}
              <td className="numeric">
                {topic.median_sessions_to_finish === null ? (
                  <span className="muted">—</span>
                ) : (
                  formatNumber(topic.median_sessions_to_finish)
                )}
              </td>
              <td className="numeric">
                {topic.total_reassignments > 0 ? (
                  formatNumber(topic.total_reassignments)
                ) : (
                  <span className="muted">0</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
