/**
 * The arithmetic every chart shares: a value, a maximum, and the percentage between them.
 *
 * ⚠️ **No pixels anywhere, and that is the invariant.** Nothing here measures an element,
 * reads a width or takes a size, because a percentage is already resolution-independent --
 * a bar at 42% is correct in a 240px card, a 900px card and in jsdom, which performs no
 * layout at all and reports every width as 0. That property is what lets the charts render
 * truthfully in tests and reflow for free in a browser, with no ResizeObserver to polyfill
 * and no viewBox to distort the marks.
 */

/**
 * Step sizes a reader can do arithmetic on: 1, 2 and 5 against every power of ten.
 *
 * 2.5 is deliberately absent, though the classic ladder includes it. Every figure these
 * charts plot is a count -- sessions, students, pages -- and a 2.5 step puts "0 / 2.5 / 5"
 * on an axis where half a session does not exist.
 */
const STEPS = [1, 2, 5, 10]

/** Tick counts worth considering. Fewer reads sparse; more crowds a 160px plot. */
const COUNTS = [3, 4, 5]

export interface Scale {
  /** The value the top gridline sits at. Every bar is a percentage of this. */
  max: number
  /** Gridline values from 0 to max inclusive. Empty when there is nothing to draw. */
  ticks: number[]
}

/**
 * The axis for a series: a round maximum, and the gridlines to reach it.
 *
 * Max and ticks come back together rather than from two functions, because they are one
 * decision -- computing them apart is how an axis ends up labelled 0/500/1000 while the
 * bars are drawn against 1200.
 *
 * **The tick count varies, and that is the point.** Holding it at four forces a choice
 * between round ticks and a tight axis: a peak of 47 over four steps wants 11.75, so the
 * ladder rounds to 20 and the axis runs to 80, wasting a third of the plot. Trying three to
 * five and keeping the tightest round answer gives 0/10/20/30/40/50 instead -- every tick
 * still round, and the tallest bar reaching 94% of the height rather than 59%.
 *
 * Always at or above the peak, so the tallest bar never overshoots the top gridline. Zero
 * in, zero out -- guarded once here because every caller divides by this.
 */
export function niceScale(values: readonly number[]): Scale {
  const peak = Math.max(0, ...values.filter((value) => Number.isFinite(value)))
  if (peak <= 0) return { max: 0, ticks: [] }

  let best: Scale | null = null

  for (const count of COUNTS) {
    const rough = peak / count
    const magnitude = 10 ** Math.floor(Math.log10(rough))
    const step = (STEPS.find((candidate) => candidate * magnitude >= rough) ?? 10) * magnitude
    const max = step * count
    // Tightest wins; on a tie the earlier (sparser) count keeps its place.
    if (!best || max < best.max) {
      best = { max, ticks: Array.from({ length: count + 1 }, (_, index) => step * index) }
    }
  }

  return best as Scale
}

/**
 * `value` as a percentage of `max`, clamped to 0-100.
 *
 * Rounded to one decimal rather than to an integer: at 24 monthly bands a whole-number
 * rounding visibly flattens the difference between neighbouring bars, and a decimal costs
 * nothing in a style attribute.
 *
 * A zero max answers 0 rather than NaN -- an empty chart draws no bars, and `width: NaN%`
 * would silently render full-width in some browsers.
 */
export function percent(value: number, max: number): number {
  if (!Number.isFinite(value) || max <= 0) return 0
  return Math.round(Math.min(100, Math.max(0, (value / max) * 100)) * 10) / 10
}
