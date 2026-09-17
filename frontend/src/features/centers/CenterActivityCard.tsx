// libraries & hooks
import { useSearchParams } from 'react-router-dom'
// apis
import { isoDay, toDate } from '../../api/bson'
import type { ExtDate } from '../../api/bson'
// components
import { Card } from '../../shell/Card'
import { DateRangeFilter } from '../DateRangeFilter'
import { CenterDistribution, DISTRIBUTION_COPY } from './CenterDistribution'
import { SessionVolume } from './SessionVolume'
// utils
import { pickInterval } from '../../charts/buckets'
import { useCardRange } from '../ranges'
// styles
import './Centers.css'

/**
 * The URL param naming which view is on screen.
 *
 * In the URL rather than in component state, for the reason the chart toggle it replaces
 * gave: a view someone opened is part of what they would send a colleague, and the browser's
 * Back button should step through it. Absent means sessions, so the default costs no param.
 */
export const VIEW_PARAM = 'view'

const VIEWS = [
  { key: 'sessions', label: 'Sessions', title: 'Sessions over time' },
  { key: 'students', label: 'Students', title: DISTRIBUTION_COPY.students.title },
  { key: 'instructors', label: 'Instructors', title: DISTRIBUTION_COPY.instructors.title },
] as const

type ViewKey = (typeof VIEWS)[number]['key']

function viewFrom(raw: string | null): ViewKey {
  const found = VIEWS.find((view) => view.key === raw)
  // An unknown or absent value falls back rather than erroring: a hand-edited URL should
  // show the card's default, not a blank card.
  return found ? found.key : 'sessions'
}

interface CenterActivityCardProps {
  /** The page's center selection, from `CenterBar`. */
  centers: string[]
  /**
   * The newest session day at those centers, for the bucket width only.
   *
   * Taken from the totals the page has already fetched rather than from a second
   * `/api/metrics` call, exactly as CenterSessionsCard takes it.
   */
  lastSession: ExtDate | null
  /** True while that anchor is still in flight. */
  anchorLoading: boolean
}

/**
 * The three charts that used to sit above the students, instructors and reports lists.
 *
 * They were built into those pages because each reused that list's own filters -- the chart
 * and the table were one query drawn twice. Read together they answer a different question,
 * "what do these centers look like", which is this page's question and not any list's, so
 * they are one card here with a selector rather than three cards on three pages.
 *
 * ⚠️ **The date range applies to the sessions view only**, and the control is hidden rather
 * than disabled on the other two. The distribution endpoints do take a date range, but it
 * bounds `last_session_date` -- "whose last session fell in this window" -- which is not
 * what a reader setting a period means. On the live data, Jan-Mar 2025 read that way returns
 * 79 students where 525 actually attended. A filter that is wrong by 6x while looking
 * plausible is worse than a filter that is absent, and CenterDistribution's own note says
 * on screen that those bars are all-time.
 *
 * The window itself is component state, never the URL: `CenterSessionsCard` above makes the
 * same choice, and this page's tests hold it to it. It opens on Any time because
 * `useCardRange` starts unbounded and nothing here seeds it.
 */
export function CenterActivityCard({
  centers,
  lastSession,
  anchorLoading,
}: CenterActivityCardProps) {
  const [params, setParams] = useSearchParams()
  const view = viewFrom(params.get(VIEW_PARAM))
  const period = useCardRange()

  const centerKey = centers.join('|')

  // The API's own spelling for a date range -- routes/filtering.py, BOUNDS. A blank bound is
  // left out rather than sent empty, so Any time lets the route apply its own default.
  const ranges: Record<string, string> = {}
  if (period.low) ranges.date_from = period.low
  if (period.high) ranges.date_to = period.high
  const rangesKey = `${period.low}|${period.high}`

  const anchor = toDate(lastSession)
  const anchorDay = anchor ? isoDay(anchor) : ''

  // ⚠️ An open end is not an unknown window. The filter's presets set only a start ("Since
  // 18 Aug") and the route resolves the other end to the newest session, so without standing
  // the anchor in, a one-month window reads as a window of unknown width, asks for monthly
  // buckets and draws itself as a single bar.
  const interval = pickInterval(ranges.date_from, ranges.date_to || anchorDay || undefined)

  // Asking before the anchor lands would fetch monthly buckets and then immediately refetch
  // weekly ones. Only worth waiting for when a bound is actually missing; a closed window
  // needs no anchor at all.
  const waiting = !ranges.date_to && !anchorDay && anchorLoading

  function choose(next: ViewKey) {
    const updated = new URLSearchParams(params)
    // Back to the default drops the param rather than spelling it out: a URL should not
    // carry state that changes nothing.
    if (next === 'sessions') updated.delete(VIEW_PARAM)
    else updated.set(VIEW_PARAM, next)
    setParams(updated)
  }

  return (
    <Card
      title={VIEWS.find((candidate) => candidate.key === view)?.title}
      showOverflow={false}
      controls={
        // Two controls in one header, wrapping rather than crowding -- the class exists for
        // exactly this pairing on the instructor workload card.
        <div className="card-controls-wrap">
          <div className="view-switch" role="group" aria-label="Chart">
            {VIEWS.map((candidate) => (
              <button
                key={candidate.key}
                type="button"
                className={
                  candidate.key === view ? 'button button-row button-on' : 'button button-row'
                }
                // The state is which view is showing, not whether this button is expanded --
                // aria-pressed is what a group of exclusive toggles says.
                aria-pressed={candidate.key === view}
                onClick={() => choose(candidate.key)}
              >
                {candidate.label}
              </button>
            ))}
          </div>

          {/* Sessions only. Hidden rather than disabled: a disabled control invites the
              reader to wonder what would happen, where an absent one plus the "all-time"
              note under the bars says the answer outright.

              ⚠️ Labelled "chart period", not "session date" like every other one of these.
              The sessions card further down this same page has its own, and two controls
              with the identical accessible name on one page is an ambiguity a screen reader
              cannot resolve -- it reads out two "Filter by session date: Any time" buttons
              that scope different cards. The label is the only thing telling them apart. */}
          {view === 'sessions' && (
            <DateRangeFilter column="date" label="chart period" standalone range={period} />
          )}
        </div>
      }
    >
      {view === 'sessions' ? (
        <SessionVolume
          centers={centers}
          centerKey={centerKey}
          ranges={ranges}
          rangesKey={rangesKey}
          interval={interval}
          waiting={waiting}
        />
      ) : (
        <CenterDistribution kind={view} centers={centers} centerKey={centerKey} />
      )}
    </Card>
  )
}
