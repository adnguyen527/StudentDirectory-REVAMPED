import { describe, expect, it } from 'vitest'

import { daysPerWeek } from '../../src/features/profile/daysPerWeek'

/** A day taught, in the shape the detail response carries. */
const day = (iso: string) => ({ $date: `${iso}T00:00:00Z` })

/** Mondays, so a case reads as "week 0, week 3" rather than as arithmetic. */
const MON = [
  '2025-01-06', '2025-01-13', '2025-01-20', '2025-01-27',
  '2025-02-03', '2025-02-10', '2025-02-17', '2025-02-24',
]
const week = (n: number) => day(MON[n])

describe('daysPerWeek', () => {
  it('divides days taught by the weeks between the first and the last', () => {
    // Four consecutive Mondays: 4 days over a 4-week span.
    const pace = daysPerWeek([week(0), week(1), week(2), week(3)])
    expect(pace.spanWeeks).toBe(4)
    expect(pace.weeksExcluded).toBe(0)
    expect(pace.rate).toBe(1)
  })

  it('counts a gap of two empty weeks against the average', () => {
    // ⚠️ The boundary the whole rule turns on. A week or two off is part of how someone
    // works, so the span stays 4 and the rate drops.
    const pace = daysPerWeek([week(0), week(3)])
    expect(pace.spanWeeks).toBe(4)
    expect(pace.weeksExcluded).toBe(0)
    expect(pace.rate).toBe(2 / 4)
  })

  it('does not count a gap of three empty weeks', () => {
    // ⚠️ One week further than the case above, and now it is an absence rather than a
    // pattern: all three come out of the denominator, leaving the two worked weeks.
    const pace = daysPerWeek([week(0), week(4)])
    expect(pace.spanWeeks).toBe(5)
    expect(pace.weeksExcluded).toBe(3)
    expect(pace.rate).toBe(2 / 2)
  })

  it('drops all four weeks of a four-week gap, not just the excess', () => {
    const pace = daysPerWeek([week(0), week(5)])
    expect(pace.spanWeeks).toBe(6)
    expect(pace.weeksExcluded).toBe(4)
    expect(pace.rate).toBe(2 / 2)
  })

  it('drops each long gap separately', () => {
    // Worked weeks 0, 4 and 7: two gaps of three and two, so only the first comes out.
    const pace = daysPerWeek([week(0), week(4), week(7)])
    expect(pace.spanWeeks).toBe(8)
    expect(pace.weeksExcluded).toBe(3)
    expect(pace.rate).toBe(3 / 5)
  })

  it('counts several days in one week once toward the span and each toward the total', () => {
    // Mon/Wed/Fri of one week, then the next Monday.
    const pace = daysPerWeek([
      day('2025-01-06'), day('2025-01-08'), day('2025-01-10'), day('2025-01-13'),
    ])
    expect(pace.daysTaught).toBe(4)
    expect(pace.spanWeeks).toBe(2)
    expect(pace.rate).toBe(2)
  })

  it('counts a day taught twice as one day', () => {
    const pace = daysPerWeek([day('2025-01-06'), day('2025-01-06'), day('2025-01-13')])
    expect(pace.daysTaught).toBe(2)
    expect(pace.rate).toBe(1)
  })

  it('refuses a rate over a span too short to support one', () => {
    // Four instructors in the real data are here. A weekly rate off a few days in one week
    // is noise, and null is what tells the page to show the raw days instead.
    const pace = daysPerWeek([day('2025-01-06'), day('2025-01-08')])
    expect(pace.spanWeeks).toBe(1)
    expect(pace.rate).toBeNull()
    expect(pace.daysTaught).toBe(2)
  })

  it('handles a single day taught', () => {
    const pace = daysPerWeek([day('2025-01-06')])
    expect(pace).toEqual({ rate: null, daysTaught: 1, spanWeeks: 1, weeksExcluded: 0 })
  })

  it('handles no days at all without dividing by zero', () => {
    expect(daysPerWeek([])).toEqual({
      rate: null, daysTaught: 0, spanWeeks: 0, weeksExcluded: 0,
    })
  })

  it('measures a gap that crosses a year boundary', () => {
    // ⚠️ The case the week *index* exists for. 2024-12-30 and 2025-01-27 are four weeks
    // apart, but their ISO year-and-week pairs are (2025,1) and (2025,5) -- and a naive
    // pair comparison across the boundary is exactly what gets this wrong.
    const pace = daysPerWeek([day('2024-12-30'), day('2025-01-27')])
    expect(pace.spanWeeks).toBe(5)
    expect(pace.weeksExcluded).toBe(3)
    expect(pace.rate).toBe(1)
  })

  it('groups by UTC, so a late Sunday does not fall into the next week', () => {
    // Stored naive and rendered in UTC everywhere else on this page; a local read would
    // push this Sunday into the following Monday's week and lengthen the span.
    const sunday = { $date: '2025-01-12T23:30:00Z' }
    const pace = daysPerWeek([day('2025-01-06'), sunday])
    expect(pace.spanWeeks).toBe(1)
    expect(pace.daysTaught).toBe(2)
  })
})
