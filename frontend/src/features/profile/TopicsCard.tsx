import { useMemo, useState } from 'react'

import { formatDate, formatNumber, toDate } from '../../api/bson'
import type { Topic, TopicState } from '../../api/types'
import { Card } from '../../shell/Card'
import { CardSearch } from '../CardSearch'
import { Pager } from '../../shell/Pager'
import './Profile.css'

type Filter = TopicState | 'all'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'on_plan', label: 'On plan' },
  { value: 'finished', label: 'Finished' },
  { value: 'removed', label: 'Removed' },
  { value: 'all', label: 'All' },
]

/** Fixed, and fixed *always*: a page with fewer rows than this is padded out to it. The
 *  card shares a row with the attendance panel, so a height that changed with the filter
 *  -- 4 on plan against 47 all-time on an ordinary student -- moved the whole row every
 *  time a chip was clicked. */
const TOPIC_PAGE = 10

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
  const [search, setSearch] = useState('')
  const [topicOffset, setTopicOffset] = useState(0)

  // The search narrows first, and the chips then count and filter what it left. That
  // order is what makes the counts useful while typing: they say which state your matches
  // are in, so a chip reading 0 is an answer rather than a dead end.
  const matching = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return topics
    // Name or id, because the row shows both and the id is a real handle -- the same
    // fields the topics list page matches, minus the former names a student's own topic
    // entry does not carry.
    return topics.filter(
      (t) =>
        t.name.toLowerCase().includes(needle) || t.id.toLowerCase().includes(needle),
    )
  }, [topics, search])

  const counts = useMemo(() => {
    const tally: Record<Filter, number> = {
      on_plan: 0,
      finished: 0,
      removed: 0,
      all: matching.length,
    }
    for (const topic of matching) tally[topic.state] += 1
    return tally
  }, [matching])

  const shown = useMemo(() => {
    const rows = filter === 'all' ? matching : matching.filter((t) => t.state === filter)
    // Most recently touched first -- a plan is read from what is current.
    const at = (topic: Topic) => toDate(topic.last_seen)?.getTime() ?? 0
    return [...rows].sort((a, b) => at(b) - at(a))
  }, [matching, filter])

  // Snapped back during render rather than reset in an effect, as the Instructors card on
  // this same page does: an effect would draw one frame of the stale page first. This
  // catches a shorter `topics` arriving under a held offset; changing the filter resets it
  // outright below, since page 2 of one filter is not page 2 of another.
  const offset = topicOffset < shown.length ? topicOffset : 0
  const page = shown.slice(offset, offset + TOPIC_PAGE)
  // What the last page, or a filter with only a few topics in it, is missing.
  const fillers = TOPIC_PAGE - page.length

  function choose(next: Filter) {
    setFilter(next)
    // The offset goes with the filter, exactly as it does on the list pages -- landing on
    // page 3 of "Finished" because you were on page 3 of "All" is not what was asked for.
    setTopicOffset(0)
  }

  return (
    <Card
      lead={
        <div className="list-controls">
          {/* The visible title is gone -- the box stands where it stood -- but the card
              still needs a name: an unnamed <section> is not exposed as a landmark, and
              this one has no page heading above it saying what it holds. */}
          <h2 className="sr-only">Topics</h2>
          <CardSearch
            value={search}
            onChange={(next) => {
              setSearch(next)
              // As the chips do: a narrower list is a different list, and page 3 of it is
              // not page 3 of the one being typed away from.
              setTopicOffset(0)
            }}
            label="Search topics"
            placeholder="Search topics by name or id"
          />
        </div>
      }
      controls={
        <div className="chips">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={value === filter ? 'chip chip-active' : 'chip'}
              onClick={() => choose(value)}
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
                {/* Declared, not derived: the name is size-contained (see .topic-name), so
                    it no longer widens the column, and the id under it would otherwise
                    size the whole thing to ~65px. */}
                <th className="topic-col">Topic</th>
                <th>Status</th>
                <th className="numeric">Sessions</th>
                <th>Last worked</th>
              </tr>
            </thead>
            <tbody>
              {page.map((topic) => (
                <tr key={topic.id}>
                  <td>
                    {/* The inner span is what scrolls on hover -- the outer one is the
                        window it scrolls behind. title, so the full name is one hover
                        away rather than one slow scroll away. */}
                    <span className="primary-name topic-name" title={topic.name}>
                      <span>{topic.name}</span>
                    </span>
                    <span className="topic-id">{topic.id}</span>
                  </td>
                  <td>
                    <span className={`status status-${topic.status.replace(' ', '-').toLowerCase()}`}>
                      {topic.status}
                    </span>
                    {/* A topic put back on the plan after coming off it -- prompted by a
                        new assessment or lesson plan, and the thing worth noticing here.

                        Rendered either way. The tag used to appear only on the rows that
                        had one, which made those rows taller and the card jump as the
                        filter changed; the stand-in holds the line open, unseen and
                        unannounced. Same trick as the filler rows below. */}
                    {topic.times_assigned > 1 ? (
                      <span className="tag tag-warn topic-flag">
                        reassigned ×{topic.times_assigned - 1}
                      </span>
                    ) : (
                      <span
                        className="tag tag-warn topic-flag topic-flag-empty"
                        aria-hidden="true"
                      >
                        &nbsp;
                      </span>
                    )}
                  </td>
                  <td className="numeric">{formatNumber(topic.sessions)}</td>
                  <td className="muted">{formatDate(topic.last_seen)}</td>
                </tr>
              ))}

              {/* Padding, so the card is the same height on every filter and every page.
                  Built from the real row's own spans rather than a colSpan cell with a
                  height: .topic-id is display:block, so a Topic cell is two stacked lines,
                  and reusing both classes makes a filler exactly as tall as a minimal real
                  row with no pixel constant to keep in sync.

                  aria-hidden because this is spacing, not an empty record -- a screen
                  reader must not read four blank cells as a topic, and it keeps
                  getAllByRole('row') returning only the rows that are really there. */}
              {Array.from({ length: fillers }, (_, i) => (
                <tr key={`filler-${i}`} aria-hidden="true">
                  <td>
                    <span className="primary-name topic-name">
                      <span>&nbsp;</span>
                    </span>
                    <span className="topic-id">&nbsp;</span>
                  </td>
                  {/* Mirrors the status cell, reserved tag line included: a filler that
                      matched a real row in one cell but not the other would be the wrong
                      height, which is the one thing it exists to get right. */}
                  <td>
                    <span className="status">&nbsp;</span>
                    <span className="tag tag-warn topic-flag topic-flag-empty">&nbsp;</span>
                  </td>
                  <td className="numeric" />
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Inside the card, below the table, as the session history's is. The whole topic
          list is already in the detail response, so a page change here costs no request.
          Held back on an empty filter so the card does not put a pager under its own
          "no topics" line. */}
      {shown.length > 0 && (
        <Pager
          page={{
            limit: TOPIC_PAGE,
            offset,
            // The filtered total, not the student's: a pager counting rows the table is
            // not showing would say "1-10 of 47" over four.
            total: shown.length,
            returned: page.length,
          }}
          onChange={setTopicOffset}
          // The last thing that still moved this card: the pager collapses its controls
          // when everything fits one page, which is every filter but "All" on most
          // students.
          reserveControls
        />
      )}
    </Card>
  )
}
