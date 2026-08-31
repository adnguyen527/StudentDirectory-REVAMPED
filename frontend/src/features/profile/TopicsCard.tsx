import { useMemo, useState } from 'react'

import { formatDate, formatNumber, toDate } from '../../api/bson'
import type { Topic, TopicState } from '../../api/types'
import { Card } from '../../shell/Card'
import './Profile.css'

type Filter = TopicState | 'all'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'on_plan', label: 'On plan' },
  { value: 'finished', label: 'Finished' },
  { value: 'removed', label: 'Removed' },
  { value: 'all', label: 'All' },
]

interface TopicsCardProps {
  topics: Topic[]
}

/**
 * The student's topic history, filtered rather than dumped -- 68 entries at the top end
 * of the current data.
 *
 * Opens on "On plan" because `state` reads the last assignment only, which is the honest
 * answer to what a student is working on now. The header's total_unique_* tiles mean
 * *ever*, so a topic mastered and later reassigned is counted there while sitting here as
 * on-plan. The two disagreeing is the data being precise, not a bug.
 */
export function TopicsCard({ topics }: TopicsCardProps) {
  const [filter, setFilter] = useState<Filter>('on_plan')

  const counts = useMemo(() => {
    const tally: Record<Filter, number> = {
      on_plan: 0,
      finished: 0,
      removed: 0,
      all: topics.length,
    }
    for (const topic of topics) tally[topic.state] += 1
    return tally
  }, [topics])

  const shown = useMemo(() => {
    const rows = filter === 'all' ? topics : topics.filter((t) => t.state === filter)
    // Most recently touched first -- a plan is read from what is current.
    const at = (topic: Topic) => toDate(topic.last_seen)?.getTime() ?? 0
    return [...rows].sort((a, b) => at(b) - at(a))
  }, [topics, filter])

  return (
    <Card
      title="Topics"
      controls={
        <div className="chips">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={value === filter ? 'chip chip-active' : 'chip'}
              onClick={() => setFilter(value)}
            >
              {label}
              <span className="chip-count">{formatNumber(counts[value])}</span>
            </button>
          ))}
        </div>
      }
      flush
    >
      {shown.length === 0 ? (
        <p className="state">No topics in this state.</p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Topic</th>
                <th>Status</th>
                <th className="numeric">Sessions</th>
                <th>Last worked</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((topic) => (
                <tr key={topic.id}>
                  <td>
                    <span className="primary-name">{topic.name}</span>
                    <span className="topic-id">{topic.id}</span>
                  </td>
                  <td>
                    <span className={`status status-${topic.status.replace(' ', '-').toLowerCase()}`}>
                      {topic.status}
                    </span>
                    {/* A topic put back on the plan after coming off it -- prompted by a
                        new assessment or lesson plan, and the thing worth noticing here. */}
                    {topic.times_assigned > 1 && (
                      <span className="tag tag-warn">reassigned ×{topic.times_assigned - 1}</span>
                    )}
                  </td>
                  <td className="numeric">{formatNumber(topic.sessions)}</td>
                  <td className="muted">{formatDate(topic.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
