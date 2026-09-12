/**
 * MongoDB Extended JSON, as the API actually speaks it.
 *
 * Every route serializes through routes/serialization.py, which runs bson.json_util over
 * the documents. So a datetime never arrives as a string -- it arrives as {"$date": ...}
 * and an ObjectId as {"$oid": "..."}. Rendering one of those directly is how a cell ends
 * up reading "[object Object]", so unwrapping lives here and every date on a page goes
 * through it.
 */

export type ExtDate = { $date: string | number | { $numberLong: string } }
export type ExtOid = { $oid: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The hex string inside {"$oid": ...}, or null. */
export function toId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (isRecord(value) && typeof value.$oid === 'string') return value.$oid
  return null
}

/**
 * A Date from {"$date": ...}, or null.
 *
 * json_util's relaxed mode (pymongo's default) writes an ISO string, canonical mode
 * writes epoch milliseconds as {"$numberLong": "..."}. Both are accepted so a change of
 * JSONOptions on the server does not silently blank every date column.
 */
export function toDate(value: unknown): Date | null {
  if (value == null) return null

  let raw: unknown = value
  if (isRecord(value) && '$date' in value) raw = value.$date
  if (isRecord(raw) && typeof raw.$numberLong === 'string') raw = Number(raw.$numberLong)

  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw
  if (typeof raw === 'number') {
    const date = new Date(raw)
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (typeof raw === 'string') {
    const date = new Date(raw)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

/**
 * Everything here renders in UTC, deliberately.
 *
 * The stored datetimes are naive: ingestion/import_reports.py builds them with
 * strptime('%m/%d/%Y') and datetime.combine(), and pymongo persists a naive datetime as
 * UTC. So the instant tagged 2025-07-30T17:53Z is not really 17:53 UTC -- it is the wall
 * clock the center wrote down, 5:53 PM, with a UTC label stuck on it.
 *
 * Rendering that in the viewer's zone re-interprets it: in US Central it slides to
 * 12:53 PM, and a date at midnight UTC lands on the day before. Formatting in UTC hands
 * back exactly the value the source recorded, from any machine.
 */
const UTC = 'UTC'

/** "30 Jun 2025", or a dash when there is no date -- never an empty cell. */
export function formatDate(value: unknown): string {
  const date = toDate(value)
  if (!date) return '—'
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: UTC,
  })
}

/** "5:53 PM", or a dash. Same UTC reasoning as formatDate. */
export function formatTime(value: unknown): string {
  const date = toDate(value)
  if (!date) return '—'
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: UTC,
  })
}

/**
 * 'YYYY-MM-DD', which is what `<input type="date">` and every date bound on the API speak.
 *
 * ⚠️ UTC, for the reason above and not by accident: a stored date sits at midnight, so
 * reading it with the local getters lands on the day before anywhere west of Greenwich --
 * and the test suite pins TZ to America/Chicago precisely so that mistake cannot pass.
 *
 * Takes a Date rather than an ExtDate because both callers already hold one from `toDate`.
 */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Today, as the reader's own calendar has it. 'YYYY-MM-DD'.
 *
 * ⚠️ **Local parts, and deliberately not `isoDay(new Date())`** -- the one place in this
 * file that does not read in UTC, which is exactly why it sits next to the rule it breaks.
 */
export function todayLocal(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** Thousands separators, so 29,382 does not read as 29382 in a stat tile. */
export function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toLocaleString()
}
