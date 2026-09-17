// libraries & hooks
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
// apis
import { formatNumber } from '../../api/bson'
import type { InstructorTopic } from '../../api/types'
// components
import { Card } from '../../shell/Card'
import { Pager } from '../../shell/Pager'
import { CardSearch } from '../CardSearch'
// styles
import './Profile.css'

/**
 * How many the card opens on, and how many a page of the full list holds.
 *
 * Ten answers the card's own title -- what do they teach most -- and stops there. It is
 * knowingly a small window: measured across the collection, an instructor's ten most-taught
 * topics are a median of only 20% of their topic-sessions, which is why the rest has to be
 * reachable rather than merely absent.
 */
const TOPIC_PAGE = 10

interface InstructorTopicsCardProps {
  /** Absent on a document built before the builder wrote topic counts -- see below. */
  topics: InstructorTopic[] | undefined
  /** Their real session count, for the footnote's arithmetic. */
  sessionsTaught: number
}

/**
 * What one instructor taught most.
 *
 * The mirror of the topic page's *Taught most by* card: the same (instructor, topic) pairs
 * read from the other side, so this copies that card's shape -- a counted title, linked
 * names against a numeric column, and a pager over an array that arrived with the page.
 *
 * It is a much longer list than its mirror, though. `topics.instructors[]` is bounded by
 * staff headcount and tops out at 82; this is bounded by the curriculum and runs to 504,
 * with a median of 126. That is why this one opens on ten and why the full view has a search
 * box: 504 rows is fifty pages, and "do they teach Fractions at all" is not a question you
 * answer by paging.
 *
 * No request of its own. The array rides along with the instructor the page has already
 * loaded -- 43 KB at the widest -- so there is no loading state here and no error state
 * either; both belong to the page that fetched it.
 */
export function InstructorTopicsCard({ topics, sessionsTaught }: InstructorTopicsCardProps) {
  const [showAll, setShowAll] = useState(false)
  const [search, setSearch] = useState('')
  const [topicOffset, setTopicOffset] = useState(0)

  /**
   * ⚠️ Matches the id as well as the name, as the student's Topics card does.
   *
   * Not a nicety: names are not unique, and 87 of 103 instructors have one appearing twice
   * or more in their own list. Searching a name that repeats should find every row carrying
   * it, and pasting an id should find the exact one.
   */
  const matching = useMemo(() => {
    const all = topics ?? []
    const needle = search.trim().toLowerCase()
    if (!needle) return all
    return all.filter(
      (topic) =>
        topic.name.toLowerCase().includes(needle) ||
        topic.topic_id.toLowerCase().includes(needle),
    )
  }, [topics, search])

  // Snapped during render rather than reset in an effect, the idiom the topic page's mirror
  // of this card uses: an effect would draw one frame of a page that no longer exists.
  const offset = topicOffset < matching.length ? topicOffset : 0
  const shown = showAll ? matching.slice(offset, offset + TOPIC_PAGE) : matching.slice(0, TOPIC_PAGE)

  function toggle() {
    setShowAll((wasOpen) => !wasOpen)
    // Collapsing back to the top ten leaves no pager to hold a position, and reopening on
    // page 34 of a list the reader last saw the top of would be a surprise.
    setTopicOffset(0)
    setSearch('')
  }

  return (
    <Card
      title={topics?.length ? `Most-taught topics · ${formatNumber(topics.length)}` : 'Most-taught topics'}
      showOverflow={false}
      controls={
        topics && topics.length > TOPIC_PAGE ? (
          <div className="card-controls-wrap">
            {/* Only with the full list. Ten rows are read at a glance; five hundred are
                searched, and a box over ten would be a control with nothing to do. */}
            {showAll && (
              <CardSearch
                value={search}
                onChange={(next) => {
                  setSearch(next)
                  setTopicOffset(0)
                }}
                placeholder="Search topics by name or id"
                label="Search this instructor's topics by name or id"
              />
            )}
            {/* Names the view it switches *to*, so one button says what both views are. */}
            <button type="button" className="button button-row" onClick={toggle}>
              {showAll ? 'Show top 10' : 'Show all'}
            </button>
          </div>
        ) : undefined
      }
      flush
    >
      {topics === undefined ? (
        /* ⚠️ Absent is not empty, and saying "no topics" here would be a wrong answer rather
           than a missing one. The collection only grew this array when the builder learned
           to write it, so a document from before that rebuild carries none at all. */
        <p className="state">
          These counts were added after this instructor’s document was built. Re-run{' '}
          <code>ingestion/build_instructors.py</code> to fill them in.
        </p>
      ) : topics.length === 0 ? (
        <p className="state">No topics were recorded on any of their sessions.</p>
      ) : matching.length === 0 ? (
        <p className="state">No topics match “{search}”.</p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th className="topic-col">Topic</th>
                  <th className="numeric">Sessions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((topic) => (
                  // The id, not the name, is the key: 87 of 103 instructors repeat a name.
                  <tr key={topic.topic_id}>
                    <td>
                      <Link
                        className="row-link primary-name topic-name"
                        to={`/topics/${encodeURIComponent(topic.topic_id)}`}
                        title={topic.name}
                      >
                        <span>{topic.name}</span>
                      </Link>
                      {/* ⚠️ Always shown. Without it the three rows a repeated name produces
                          read as one row triplicated with contradictory counts. */}
                      <span className="topic-id">{topic.topic_id}</span>
                    </td>
                    <td className="numeric">{formatNumber(topic.sessions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="muted table-footnote">{footnote(topics, matching, showAll, sessionsTaught)}</p>

          {/* Only with the full list: the top ten is the whole of what it claims to be. */}
          {showAll && (
            <Pager
              page={{
                limit: TOPIC_PAGE,
                offset,
                total: matching.length,
                returned: shown.length,
              }}
              onChange={setTopicOffset}
            />
          )}
        </>
      )}
    </Card>
  )
}

/**
 * The line under the table: what is being shown, and why it does not add up.
 *
 * ⚠️ The arithmetic caveat is the important half. A session covers several topics, so an
 * instructor's per-topic sessions come to about 1.73 times the sessions they actually
 * taught -- and the Sessions tile at the top of this same page shows that smaller number. A
 * reader totalling the column finds the two contradict each other, so the card says which
 * is which rather than leaving it to be discovered.
 */
function footnote(
  topics: InstructorTopic[],
  matching: InstructorTopic[],
  showAll: boolean,
  sessionsTaught: number,
) {
  const scope = !showAll && topics.length > TOPIC_PAGE
    ? `Their ${TOPIC_PAGE} most taught, of ${formatNumber(topics.length)}.`
    : matching.length === topics.length
      ? `All ${formatNumber(topics.length)} topics they have taught.`
      : `${formatNumber(matching.length)} of ${formatNumber(topics.length)} topics.`

  return (
    `${scope} A session covers several topics, so these count the sessions a topic came up ` +
    `in and add to more than the ${formatNumber(sessionsTaught)} sessions they taught — ` +
    'read each row on its own.'
  )
}
