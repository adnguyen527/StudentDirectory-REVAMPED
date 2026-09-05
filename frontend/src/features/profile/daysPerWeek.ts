import { toDate } from '../../api/bson'
import type { ExtDate } from '../../api/bson'

/** Below this the span is too short for a weekly rate to mean anything. */
const MIN_SPAN_WEEKS = 2

/**
 * A run of empty weeks this long is an absence rather than a pattern, and is not charged
 * against the average. One or two weeks off still count -- a week off is part of how
 * someone works -- but a longer break is a term break, a closure or leave, and counting it
 * measures the calendar rather than the person.
 */
const BREAK_WEEKS = 3

export interface WeeklyPace {
  /** Days a week over the counted span, or null where the span is too short to mean it. */
  rate: number | null
  daysTaught: number
  spanWeeks: number
  /** Weeks dropped as absences. Worth showing: the rate is adjusted, and a reader who
   *  cannot see that it was adjusted cannot check it. */
  weeksExcluded: number
}

/**
 * The Monday-start week a date falls in, as one orderable integer.
 *
 * ⚠️ A week *index*, not an `(isoYear, isoWeek)` pair. It is the same grouping ISO weeks
 * give, but walking a span and spotting consecutive runs is arithmetic on this, where the
 * pairs sort wrongly across a year boundary and need special-casing for the 52/53-week
 * years. The epoch, 1970-01-01, was a Thursday, so `+3` shifts the buckets onto Mondays.
 *
 * UTC throughout: these are naive wall-clock dates, and a local read pushes a Sunday or
 * Monday across a week boundary -- the same trap the months grouping on this page names.
 */
function weekIndex(date: Date): number {
  const utcDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  return Math.floor((utcDay / 86_400_000 + 3) / 7)
}

/**
 * How often an instructor actually works, rather than how much they have worked.
 *
 * Days taught divided by the weeks between their first day and their last, with long
 * absences taken out of the denominator. On the current data that correction moves the
 * median from 1.55 to 1.76 days a week and the worst case from 0.18 to 0.62; it drops 384
 * of 2,624 span weeks, 15%, so it is not a rare adjustment.
 */
export function daysPerWeek(days: ExtDate[]): WeeklyPace {
  // Distinct calendar days: a day with two sessions on it is one day taught.
  const weeks = new Set<number>()
  for (const day of days) {
    const date = toDate(day)
    if (date) weeks.add(weekIndex(date))
  }
  const daysTaught = new Set(
    days.map((d) => toDate(d)?.toISOString().slice(0, 10)).filter(Boolean),
  ).size

  if (weeks.size === 0) {
    return { rate: null, daysTaught: 0, spanWeeks: 0, weeksExcluded: 0 }
  }

  const worked = [...weeks].sort((a, b) => a - b)
  const first = worked[0]
  const last = worked[worked.length - 1]
  const spanWeeks = last - first + 1

  // Every gap between two worked weeks, with the long ones taken out. A run after the last
  // day taught cannot exist -- the span ends on a worked week -- so there is no trailing
  // case to handle.
  let weeksExcluded = 0
  for (let i = 1; i < worked.length; i += 1) {
    const empty = worked[i] - worked[i - 1] - 1
    if (empty >= BREAK_WEEKS) weeksExcluded += empty
  }

  const counted = spanWeeks - weeksExcluded
  return {
    rate: spanWeeks < MIN_SPAN_WEEKS || counted <= 0 ? null : daysTaught / counted,
    daysTaught,
    spanWeeks,
    weeksExcluded,
  }
}
