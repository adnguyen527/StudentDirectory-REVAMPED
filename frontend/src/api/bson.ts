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

/** "30 Jun 2025", or a dash when there is no date -- never an empty cell. */
export function formatDate(value: unknown): string {
  const date = toDate(value)
  if (!date) return '—'
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** Thousands separators, so 29,382 does not read as 29382 in a stat tile. */
export function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toLocaleString()
}
