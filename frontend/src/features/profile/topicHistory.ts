import { toDate } from '../../api/bson'
import type { DwpReport, Topic, TopicStatus } from '../../api/types'

/** One session that recorded this topic, and what it said that day. */
export interface TopicObservation {
  /** 'YYYY-MM-DD' in UTC. */
  iso: string
  status: TopicStatus
}

export interface TopicHistory {
  id: string
  name: string
  /** Where the topic stands now, from the built aggregate rather than derived here. */
  status: TopicStatus
  state: Topic['state']
  observations: TopicObservation[]
}

export interface Span {
  /** 'YYYY-MM-DD' of the student's first and last recorded session. */
  start: string
  end: string
  /** Whole days between them, at least 1 so a single-session student still divides. */
  days: number
}

const DAY = 86_400_000

/** 'YYYY-MM-DD' in UTC -- these are naive wall-clock dates and a local read shifts them. */
function isoOf(value: DwpReport['date']): string | null {
  const date = toDate(value)
  return date ? date.toISOString().slice(0, 10) : null
}

/**
 * When the student's sessions run from and to.
 *
 * Taken from the reports rather than from the student's `last_session_date`, so the axis
 * cannot extend past the marks it is drawn to hold.
 */
export function sessionSpan(reports: DwpReport[]): Span | null {
  const days = reports.map((report) => isoOf(report.date)).filter((iso) => iso !== null)
  if (days.length === 0) return null

  const sorted = [...days].sort()
  const start = sorted[0]
  const end = sorted[sorted.length - 1]
  return {
    start,
    end,
    days: Math.max(1, (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY),
  }
}

/**
 * Each topic and the sessions that recorded it.
 *
 * ⚠️ **Observations, not progress.** The source writes one status per topic per session, on
 * the sessions the topic was actually worked. Between two marks it records nothing at all:
 * not "in progress", not "paused", nothing -- and a fifth of reports carry no topics, so
 * some of the gaps are an absent record rather than an absent session. Whatever draws these
 * must not join them up.
 *
 * ⚠️ **The current status comes from `topics`, not from the last observation.** The status
 * ladder is not written cumulatively -- a mastered topic is almost never also written as
 * `Completed` -- so the newest mark is what one day said, while `Topic.status` is what the
 * builder concluded across the whole history. They can disagree, and the aggregate is right.
 *
 * Reports arrive newest first; observations come back oldest first, which is the order an
 * axis reads in.
 */
export function topicHistories(reports: DwpReport[], topics: Topic[]): TopicHistory[] {
  const seen = new Map<string, TopicObservation[]>()

  for (const report of reports) {
    const iso = isoOf(report.date)
    // topics is `SessionTopic[] | null`: a fifth of reports record none at all.
    if (!iso || !report.topics) continue
    for (const topic of report.topics) {
      seen.set(topic.id, [...(seen.get(topic.id) ?? []), { iso, status: topic.status }])
    }
  }

  const histories = topics.map((topic) => ({
    id: topic.id,
    name: topic.name,
    status: topic.status,
    state: topic.state,
    observations: [...(seen.get(topic.id) ?? [])].sort((a, b) => a.iso.localeCompare(b.iso)),
  }))

  // Most recently worked first: what a reader opening a profile is looking for is what is
  // happening now, and a topic last seen a year ago is context rather than news.
  return histories.sort((a, b) => {
    const left = a.observations[a.observations.length - 1]?.iso ?? ''
    const right = b.observations[b.observations.length - 1]?.iso ?? ''
    return right.localeCompare(left) || a.name.localeCompare(b.name)
  })
}

/**
 * Where a date sits along the span, 0-100.
 *
 * A percentage, so the row needs no measuring and stays correct at any card width.
 */
export function placeOn(span: Span, iso: string): number {
  const offset = (Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${span.start}T00:00:00Z`)) / DAY
  if (!Number.isFinite(offset)) return 0
  return Math.round(Math.min(100, Math.max(0, (offset / span.days) * 100)) * 10) / 10
}
