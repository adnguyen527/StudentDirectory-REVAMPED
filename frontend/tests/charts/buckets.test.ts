import { describe, expect, it } from 'vitest'

import { bucketLabel, bucketRange, pickInterval } from '../../src/charts/buckets'

/**
 * Bucket width and bucket labels.
 *
 * ⚠️ vitest.config.ts pins TZ to America/Chicago on purpose, so a date read locally instead
 * of in UTC lands on the wrong day here rather than passing on a UTC machine. These
 * assertions are written against UTC and would fail if anything in buckets.ts reached for a
 * local getter.
 */

describe('pickInterval', () => {
  it('keeps daily bars while they still fit', () => {
    expect(pickInterval('2026-03-07', '2026-03-14')).toBe('day')
    // 70 days inclusive is the edge, and it holds.
    expect(pickInterval('2026-01-01', '2026-03-11')).toBe('day')
  })

  it('widens to weeks once a day a bar stops being readable', () => {
    expect(pickInterval('2026-01-01', '2026-06-30')).toBe('week')
  })

  it('widens to months over a long span', () => {
    expect(pickInterval('2024-08-09', '2026-03-14')).toBe('month')
  })

  it('answers month when either bound is missing', () => {
    // No window means the API's own default, which is the widest useful view.
    expect(pickInterval(undefined, '2026-03-14')).toBe('month')
    expect(pickInterval('2026-03-01', undefined)).toBe('month')
    expect(pickInterval()).toBe('month')
  })

  it('does not trip over a backwards range', () => {
    // The API refuses it with a 400; this only has to not produce nonsense first.
    expect(pickInterval('2026-03-14', '2026-01-01')).toBe('month')
  })
})

describe('bucketLabel', () => {
  it('shortens a day to its day and month', () => {
    expect(bucketLabel('2025-09-17', 'day')).toBe('17 Sep')
    // No zero padding: '7 Mar' reads as a date, '07 Mar' reads as a code.
    expect(bucketLabel('2025-03-07', 'day')).toBe('7 Mar')
  })

  it('shortens a month to its name', () => {
    expect(bucketLabel('2025-09', 'month')).toBe('Sep')
    expect(bucketLabel('2024-12', 'month')).toBe('Dec')
  })

  it('shortens an ISO week to its number', () => {
    expect(bucketLabel('2025-W38', 'week')).toBe('W38')
    // ⚠️ The week-year is not the calendar year -- 2025-12-29 is in 2026-W01 -- so the
    // label drops the year rather than appearing to contradict the axis around it.
    expect(bucketLabel('2026-W01', 'week')).toBe('W01')
  })

  it('returns an unrecognised key unchanged rather than mangling it', () => {
    // The API owns this spelling; a new interval should read as an odd label, not an empty one.
    expect(bucketLabel('whatever', 'month')).toBe('whatever')
  })
})

describe('bucketRange', () => {
  const utc = (iso: string) => new Date(`${iso}T00:00:00Z`)

  it('names the days a week covers, which its label cannot', () => {
    // ⚠️ The point of the whole hint. "W25" answers "which week?" with nothing, and a
    // timeline is unreadable without knowing when.
    expect(bucketRange(utc('2025-06-16'), utc('2025-06-22'), 'week')).toBe('16–22 Jun 2025')
  })

  it('names both months when a week straddles them', () => {
    expect(bucketRange(utc('2026-01-26'), utc('2026-02-01'), 'week')).toBe('26 Jan – 1 Feb 2026')
  })

  it('names both years when a week straddles them', () => {
    // ⚠️ The ISO week-year is not the calendar year, so this week's key is 2026-W01 while it
    // starts in 2025 -- stating both is the only unambiguous reading.
    expect(bucketRange(utc('2025-12-29'), utc('2026-01-04'), 'week')).toBe(
      '29 Dec 2025 – 4 Jan 2026',
    )
  })

  it('gives a day its year, which the axis drops', () => {
    expect(bucketRange(utc('2025-09-17'), utc('2025-09-17'), 'day')).toBe('17 Sep 2025')
  })

  it('spells a month out in full', () => {
    expect(bucketRange(utc('2025-09-01'), utc('2025-09-30'), 'month')).toBe('September 2025')
  })

  it('reads in UTC, so a midnight boundary does not slip a day', () => {
    // The suite pins TZ to America/Chicago: a local getter would call this the 16th.
    expect(bucketRange(utc('2025-06-17'), utc('2025-06-17'), 'day')).toBe('17 Jun 2025')
  })
})
