import { describe, expect, it } from 'vitest'

import { niceScale, percent } from '../../src/charts/scale'

/**
 * The chart arithmetic, with no DOM anywhere near it.
 *
 * This is where proportionality is proven. jsdom performs no layout -- every width is 0 --
 * so a rendered bar's size is not observable, and by this project's convention is not
 * asserted on either. Pinning the maths here is what makes the components' `width: N%`
 * trustworthy without measuring anything.
 */

describe('niceScale', () => {
  it('varies the tick count to keep the axis both round and tight', () => {
    // A peak of 47 over a fixed four ticks would round to 20 a step and run the axis to 80,
    // wasting a third of the plot. Five ticks of 10 is round and reaches 50.
    expect(niceScale([3, 47, 12])).toEqual({ max: 50, ticks: [0, 10, 20, 30, 40, 50] })
  })

  it('rounds to numbers a reader can do arithmetic on', () => {
    expect(niceScale([1761]).max).toBe(2000)
    expect(niceScale([8456]).max).toBe(10000)
    expect(niceScale([446]).max).toBe(500)
  })

  it('never steps by a fraction, because every figure here is a count', () => {
    // Half a session does not exist, so 2.5 is off the ladder.
    for (const peak of [3, 9, 47, 230, 1761, 8456]) {
      for (const tick of niceScale([peak]).ticks) {
        expect(Number.isInteger(tick)).toBe(true)
      }
    }
  })

  it('never lands below the peak, so the tallest bar cannot overshoot the axis', () => {
    for (const peak of [1, 7, 46, 99, 100, 101, 1068, 5945, 29382]) {
      expect(niceScale([peak]).max).toBeGreaterThanOrEqual(peak)
    }
  })

  it('keeps the axis honest -- the ticks run 0 to max in equal steps', () => {
    for (const peak of [7, 47, 446, 1761, 8456]) {
      const { max, ticks } = niceScale([peak])
      expect(ticks[0]).toBe(0)
      expect(ticks[ticks.length - 1]).toBe(max)
      const step = ticks[1]
      ticks.forEach((tick, index) => expect(tick).toBeCloseTo(step * index, 6))
    }
  })

  it('draws nothing at all for an empty or all-zero series', () => {
    // Every caller divides by max, so it is guarded here exactly once; and a lone 0
    // gridline says nothing the empty state does not say better.
    expect(niceScale([])).toEqual({ max: 0, ticks: [] })
    expect(niceScale([0, 0])).toEqual({ max: 0, ticks: [] })
  })

  it('ignores values that are not finite', () => {
    expect(niceScale([10, Number.NaN, 20]).max).toBe(20)
  })
})

describe('percent', () => {
  it('is the share of the max', () => {
    expect(percent(47, 50)).toBe(94)
    expect(percent(50, 50)).toBe(100)
    expect(percent(0, 50)).toBe(0)
  })

  it('keeps one decimal, so neighbouring bars stay distinguishable', () => {
    // Across 24 monthly bands, whole-number rounding visibly flattens real differences.
    expect(percent(1, 3)).toBe(33.3)
  })

  it('never divides by zero', () => {
    // width: NaN% renders full-width in some browsers -- an empty chart must draw nothing.
    expect(percent(5, 0)).toBe(0)
    expect(percent(Number.NaN, 10)).toBe(0)
  })

  it('clamps rather than overflowing its track', () => {
    expect(percent(80, 50)).toBe(100)
    expect(percent(-5, 50)).toBe(0)
  })
})
