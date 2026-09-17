import { useState } from 'react'
// libraries
import { Link } from 'react-router-dom'
// apis
import { formatLongDate, formatNumber } from '../../api/bson'
import type { DwpReport, Topic } from '../../api/types'
// components
import { ChartFigure } from '../../charts/ChartFigure'
import { ChartTable } from '../../charts/ChartTable'
import { useRovingGroup } from '../../charts/useRovingGroup'
import { Card } from '../../shell/Card'
import { HoverTarget, type HoverCardContent } from '../../shell/HoverCard'
// utils
import { placeOn, sessionSpan, topicHistories, type TopicHistory, type TopicObservation } from './topicHistory'
// styles
import '../../charts/Chart.css'
import './Profile.css'

/** What a mark says on hover -- the topic it belongs to, then the session and the status. */
function cardOf(history: TopicHistory, observation: TopicObservation): HoverCardContent {
  return {
    header: history.name,
    rows: [
      { name: 'Date', value: formatLongDate(observation.iso) },
      { name: 'Status', value: observation.status },
    ],
  }
}

/** The same reading, flattened to one string -- the mark's accessible name. */
function describeMark(history: TopicHistory, observation: TopicObservation): string {
  return `${history.name} — ${formatLongDate(observation.iso)}: ${observation.status}`
}

/** Running totals before each row, so a flat mark index can be split back into row/offset. */
function rowStarts(lengths: readonly number[]): number[] {
  const starts: number[] = []
  let sum = 0
  for (const length of lengths) {
    starts.push(sum)
    sum += length
  }
  return starts
}

interface TopicProgressCardProps {
  reports: DwpReport[]
  topics: Topic[]
}

/**
 * Which topics to show, and why there is a choice at all.
 *
 * Measured across all 893 students before settling on a default: a student carries a median
 * of 11 topics and as many as 125, but the ones *currently on a plan* are a median of 3 and
 * never more than 7. So "on plan" opens on what is happening now and always fits, while
 * "all" is a scroll for the widest students and is there when the whole history is the
 * question.
 *
 * Volume was never the problem the README worried about -- the widest student has 125
 * topics but only 346 recorded observations, because a topic appears in a handful of
 * sessions rather than all of them. Row count is.
 */
const VIEWS = {
  on_plan: {
    /** What the *button* offers, which is the other view -- not the one showing. */
    action: 'Show full history',
    keep: (history: TopicHistory) => history.state === 'on_plan',
  },
  all: {
    action: 'Show current only',
    keep: () => true,
  },
} as const

type ViewKey = keyof typeof VIEWS

/**
 * ⚠️ Deliberately not labelled "On plan" / "All".
 *
 * The Topics card on this same page already has an On plan chip over the topic table, and
 * two controls with the same name doing the same filtering is a page that reads as broken
 * even when it works. One button naming the view it switches *to* also says what the other
 * view is, which two buttons cannot do without repeating the current state.
 */

export function TopicProgressCard({ reports, topics }: TopicProgressCardProps) {
  const [view, setView] = useState<ViewKey>('on_plan')

  const span = sessionSpan(reports)
  const histories = topicHistories(reports, topics)
  const shown = histories.filter(VIEWS[view].keep)

  const rowLengths = shown.map((history) => history.observations.length)
  const starts = rowStarts(rowLengths)
  const { groupProps, itemProps } = useRovingGroup({
    count: rowLengths.reduce((sum, length) => sum + length, 0),
    rows: rowLengths,
  })

  return (
    <Card
      title="Topics over time"
      showOverflow={false}
      controls={
        <button
          type="button"
          className="button button-row"
          onClick={() => setView(view === 'on_plan' ? 'all' : 'on_plan')}
        >
          {VIEWS[view].action}
        </button>
      }
    >
      {!span || shown.length === 0 ? (
        <p className="state">
          {view === 'on_plan'
            ? 'No topics are on this student’s plan right now.'
            : 'No topics recorded for this student.'}
        </p>
      ) : (
        <ChartFigure
          caption="Topics over time"
          note={
            /* ⚠️ Visible, not sr-only, and the single most important thing on this card.
               The marks are the sessions that recorded a topic; between two of them the
               source says nothing at all. A reader who assumes the gaps are steady work is
               reading something the data does not contain, and the person who most needs
               telling is the one looking at the picture. */
            'Each mark is a session that recorded the topic. The source writes one status per session, so nothing is recorded between two marks — a gap is not progress, and not a pause either.'
          }
          twin={
            <ChartTable
              caption="Topics over time"
              columns={['Topic', 'Sessions', 'First', 'Last', 'Status now']}
              rows={shown.map((history) => [
                history.name,
                formatNumber(history.observations.length),
                history.observations[0]?.iso ?? '—',
                history.observations[history.observations.length - 1]?.iso ?? '—',
                history.status,
              ])}
            />
          }
          interactiveMarks
        >
          <div className="topic-track-list" onKeyDown={groupProps.onKeyDown}>
            {shown.map((history, historyIndex) => (
              <div className="topic-track-row" key={history.id}>
                <Link className="topic-track-name row-link" to={`/topics/${encodeURIComponent(history.id)}`}>
                  {history.id}: {history.name}
                </Link>
                <span className="topic-track">
                  {history.observations.map((observation, obsIndex) => (
                    // Discrete marks, never joined. A line between two of these would draw
                    // a claim the source does not make.
                    <HoverTarget
                      as="span"
                      className="topic-mark"
                      key={`${observation.iso}-${observation.status}`}
                      data-status={observation.status}
                      style={{ left: `${placeOn(span, observation.iso)}%` }}
                      card={cardOf(history, observation)}
                      aria-label={describeMark(history, observation)}
                      {...itemProps(starts[historyIndex] + obsIndex)}
                    />
                  ))}
                </span>
                {/* The status the builder concluded, not the newest mark: the ladder is not
                    written cumulatively, so the two can disagree and the aggregate is right. */}
                <span className={`topic-now topic-now-${history.status.replace(/\s+/g, '-').toLowerCase()}`}>
                  {history.status}
                </span>
              </div>
            ))}
          </div>

          <div className="topic-track-axis" aria-hidden="true">
            <span>{span.start}</span>
            <span>{span.end}</span>
          </div>
        </ChartFigure>
      )}
    </Card>
  )
}
