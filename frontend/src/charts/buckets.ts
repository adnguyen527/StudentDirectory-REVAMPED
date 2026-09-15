import { toDate } from '../api/bson'
import type { ExtDate } from '../api/bson'

/**
 * Reading the API's time buckets: which interval to ask for, and what to call one.
 *
 * ⚠️ UTC throughout, as everywhere else that touches these dates. The stored datetimes are
 * naive wall clock (see combine_session_time in ingestion/import_reports.py) and are read
 * back in UTC; a local reading pushes a midnight session onto the previous day. The test
 * suite pins TZ to America/Chicago precisely so that mistake fails rather than passes --
 * see vitest.config.ts.
 */

export type Interval = 'day' | 'week' | 'month'

/**
 * Past this many bars the axis stops being readable.
 *
 * Stricter than the API's own limit and always binding before it: models/trends.py refuses
 * a window over 750 buckets, but 750 daily bars in a card is a texture rather than a chart,
 * so widening the interval here means the API's refusal is never reached from this app.
 */
const READABLE = 70

const DAY = 86_400_000

/**
 * The widest interval that keeps the chart readable over [from, to].
 *
 * The API accepts any of the three for any window, so this is a presentation choice rather
 * than a constraint: a year of daily bars is 365 marks in a card 600px wide, which is a
 * texture rather than a chart. Widening the bucket as the range grows keeps roughly the
 * same number of bars on screen at every zoom.
 *
 * An unbounded window means the API's own default, which is monthly for the home charts and
 * daily elsewhere -- so this answers `month`, matching what the widest useful default is.
 * Both bounds are 'YYYY-MM-DD' as the URL carries them.
 */
export function pickInterval(from?: string, to?: string): Interval {
  if (!from || !to) return 'month'

  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY
  if (!Number.isFinite(days) || days < 0) return 'month'

  if (days + 1 <= READABLE) return 'day'
  if (days / 7 + 1 <= READABLE) return 'week'
  return 'month'
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function dayAndMonth(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
}

/**
 * The days a bucket actually covers, spelled out -- what the hover says.
 *
 * ⚠️ The axis label cannot carry this and should not try. `W25` is four characters because
 * fifty of them have to sit side by side; but `W25` alone answers "which week is that?"
 * with nothing at all, and reading a timeline means knowing *when*. So the axis stays
 * terse and the tooltip is where the dates live -- along with the table twin, which
 * carries them for anyone who cannot hover at all.
 *
 * Only as much as is needed: a week inside one month repeats neither the month nor the
 * year, and one that crosses a year boundary states both. Weeks are Monday to Sunday, as
 * the ISO key they are matched by already is.
 */
export function bucketRange(start: Date, end: Date, interval: Interval): string {
  if (interval === 'month') {
    return `${MONTHS_LONG[start.getUTCMonth()]} ${start.getUTCFullYear()}`
  }
  if (interval === 'day') {
    return `${dayAndMonth(start)} ${start.getUTCFullYear()}`
  }

  const sameYear = start.getUTCFullYear() === end.getUTCFullYear()
  if (sameYear && start.getUTCMonth() === end.getUTCMonth()) {
    return `${start.getUTCDate()}–${end.getUTCDate()} ${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`
  }
  if (sameYear) {
    return `${dayAndMonth(start)} – ${dayAndMonth(end)} ${start.getUTCFullYear()}`
  }
  return `${dayAndMonth(start)} ${start.getUTCFullYear()} – ${dayAndMonth(end)} ${end.getUTCFullYear()}`
}

/**
 * A bucket key shortened for an axis: '2025-09-17' -> '17 Sep', '2025-W38' -> 'W38',
 * '2025-09' -> 'Sep'.
 *
 * The year is dropped because the card's own lead line states the window, and repeating it
 * on every one of twelve bands is noise. The full key survives in the chart's table twin
 * and in each bar's tooltip, so nothing is lost -- only the axis is abbreviated.
 *
 * An unrecognised key is returned unchanged rather than mangled: the API owns this spelling
 * and a new interval should show up as an odd label, not as an empty one.
 */
export function bucketLabel(key: string, interval: Interval): string {
  if (interval === 'week') return key.slice(key.indexOf('W'))

  const [year, month, day] = key.split('-')
  const name = MONTHS[Number(month) - 1]
  if (!year || !name) return key

  if (interval === 'month') return name
  return day ? `${Number(day)} ${name}` : key
}

/**
 * `bucketRange` straight off a bucket's own `start`/`end`, which arrive as Extended JSON.
 *
 * Here rather than in each chart so the three time charts cannot describe the same week
 * three different ways. Answers undefined when either end is missing, which leaves the
 * caller's axis label to stand in -- a bucket with no dates is not worth a wrong tooltip.
 */
export function bucketHint(
  start: ExtDate | null | undefined,
  end: ExtDate | null | undefined,
  interval: Interval,
): string | undefined {
  const from = toDate(start ?? null)
  const to = toDate(end ?? null)
  if (!from || !to) return undefined
  return bucketRange(from, to, interval)
}
