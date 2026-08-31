import { describe, expect, it } from 'vitest'

import { formatDate, formatNumber, formatTime, toDate, toId } from '../../src/api/bson'

/**
 * The regression these guard is a bug that shipped: dates rendered a day early and
 * sessions moved several hours, because the values were formatted in the viewer's zone.
 *
 * The stored datetimes are naive wall clock kept as UTC (see combine_session_time in
 * ingestion/import_reports.py), so UTC is the only reading that returns what the center
 * wrote down. These tests pin that, and they only mean something when the machine running
 * them is NOT on UTC -- so each one names the value a local reading would have produced.
 */
describe('the test environment itself', () => {
  it('runs in a non-UTC zone, or the tests below prove nothing', () => {
    // vitest.config.ts pins TZ. If that is ever dropped and CI runs UTC, a local reading
    // and a UTC reading agree and every assertion below passes with the fix removed.
    // This fails first and says why.
    const offset = new Date('2025-07-30T17:53:00Z').getTimezoneOffset()
    expect(offset, 'TZ is UTC — see the env block in vitest.config.ts').not.toBe(0)
  })
})

describe('toDate', () => {
  it('reads the relaxed $date form pymongo emits by default', () => {
    expect(toDate({ $date: '2025-07-30T17:53:00Z' })?.toISOString()).toBe(
      '2025-07-30T17:53:00.000Z',
    )
  })

  it('also reads the canonical $numberLong form', () => {
    // A change of JSONOptions on the server must not silently blank every date column.
    const millis = Date.UTC(2025, 6, 30, 17, 53)
    expect(toDate({ $date: { $numberLong: String(millis) } })?.toISOString()).toBe(
      '2025-07-30T17:53:00.000Z',
    )
  })

  it('passes a Date and a raw epoch through', () => {
    // Not every caller hands over an envelope: a value already unwrapped upstream, or a
    // plain millisecond number, must not come back null.
    const date = new Date('2025-07-30T17:53:00Z')
    expect(toDate(date)).toBe(date)
    expect(toDate(Date.UTC(2025, 6, 30))?.toISOString()).toBe('2025-07-30T00:00:00.000Z')
  })

  it('rejects an invalid Date rather than passing it along', () => {
    expect(toDate(new Date('nonsense'))).toBeNull()
    expect(toDate(Number.NaN)).toBeNull()
  })

  it('returns null for null, undefined and unparseable values', () => {
    expect(toDate(null)).toBeNull()
    expect(toDate(undefined)).toBeNull()
    expect(toDate({ $date: 'not a date' })).toBeNull()
    expect(toDate({})).toBeNull()
  })
})

describe('formatDate', () => {
  it('renders midnight UTC as that day, not the day before', () => {
    // The bug: in any zone west of UTC this read "Jul 29".
    expect(formatDate({ $date: '2025-07-30T00:00:00Z' })).toBe('Jul 30, 2025')
  })

  it('renders a dash rather than an empty cell when there is no date', () => {
    expect(formatDate(null)).toBe('—')
  })
})

describe('formatTime', () => {
  it('renders the wall clock the source recorded', () => {
    // The bug: in US Central this read "12:53 PM", moving an after-school session to
    // lunchtime.
    expect(formatTime({ $date: '2025-07-30T17:53:00Z' })).toBe('5:53 PM')
  })

  it('returns a dash for a missing time', () => {
    expect(formatTime(null)).toBe('—')
  })
})

describe('toId', () => {
  it('unwraps $oid and passes a bare string through', () => {
    expect(toId({ $oid: '64b0000000000000000000a1' })).toBe('64b0000000000000000000a1')
    expect(toId('already-a-string')).toBe('already-a-string')
    expect(toId(null)).toBeNull()
  })
})

describe('formatNumber', () => {
  it('groups thousands so a stat tile does not read as one long digit run', () => {
    expect(formatNumber(29382)).toBe('29,382')
  })

  it('distinguishes zero from absent', () => {
    // A real zero is a fact; a missing value is not. They must not render alike.
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(null)).toBe('—')
    expect(formatNumber(undefined)).toBe('—')
  })
})
