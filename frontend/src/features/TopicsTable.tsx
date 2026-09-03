import { Link } from 'react-router-dom'

import { formatNumber } from '../api/bson'
import type { TopicListItem } from '../api/types'
import { NumberRangeFilter } from './NumberRangeFilter'
import { ColumnHeader } from './SortHeader'

interface TopicsTableProps {
  topics: TopicListItem[]
  sortable?: boolean
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
export function TopicsTable({ topics, sortable }: TopicsTableProps) {
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          {/* Median sessions is the one column that is null rather than 0 on rows
              with no value -- 109 of 771 topics. The API keeps those at the bottom
              whichever way it is sorted; see Topic._page. */}
          <tr>
            <ColumnHeader sortable={sortable} column="name" first="asc">
              Topic
            </ColumnHeader>
            <ColumnHeader
              sortable={sortable}
              column="sessions"
              className="numeric"
              filter={<NumberRangeFilter column="sessions" label="sessions" />}
            >
              Sessions
            </ColumnHeader>
            <ColumnHeader
              sortable={sortable}
              column="students"
              className="numeric"
              filter={<NumberRangeFilter column="students" label="students" />}
            >
              Students
            </ColumnHeader>
            <ColumnHeader
              sortable={sortable}
              column="finished"
              className="numeric"
              filter={<NumberRangeFilter column="finished" label="finished" />}
            >
              Finished
            </ColumnHeader>
            <ColumnHeader
              sortable={sortable}
              column="on_plan"
              className="numeric"
              filter={<NumberRangeFilter column="on_plan" label="on plan" />}
            >
              On plan
            </ColumnHeader>
            <ColumnHeader
              sortable={sortable}
              column="removed"
              className="numeric"
              filter={<NumberRangeFilter column="removed" label="removed" />}
            >
              Removed
            </ColumnHeader>
            <ColumnHeader
              sortable={sortable}
              column="median"
              className="numeric"
              filter={
                <NumberRangeFilter
                  column="median"
                  label="median sessions"
                  // 109 of 771 topics have no median at all, and no range can match a
                  // null -- so the filter quietly drops them and has to say so.
                  note="Topics nobody has finished have no median, so any range here leaves them out."
                />
              }
            >
              Median sessions
            </ColumnHeader>
            <ColumnHeader
              sortable={sortable}
              column="reassigned"
              className="numeric"
              filter={<NumberRangeFilter column="reassigned" label="reassigned" />}
            >
              Reassigned
            </ColumnHeader>
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
