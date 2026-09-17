import type { ReactNode } from 'react'

import './Chart.css'

interface ChartFigureProps {
  /** What the chart is, as a sentence fragment -- "Students by center". */
  caption: string
  /** Reserved-height placeholder while the data is in flight. */
  loading?: boolean
  /** What a dimmed mark or a gap means. Visible, not hidden -- see below. */
  note?: ReactNode
  /** The marks. Hidden from assistive tech unless `interactiveMarks`; `twin` is the readable copy. */
  children: ReactNode
  /** The ChartTable carrying the same numbers. */
  twin: ReactNode
  /**
   * Opts the plot into a roving-tabindex group instead of hiding it from assistive tech.
   *
   * Defaults `false` on purpose: Home's compact small multiples render the same marks with
   * no room for a hover card, and defaulting this on would give them tab stops nobody
   * asked for. A chart that wants hover/keyboard access sets it explicitly.
   */
  interactiveMarks?: boolean
}

/**
 * The wrapper every chart shares: a name, a skeleton, the marks, a note and the twin.
 *
 * Deliberately **not** a chart frame. It holds no axis, no ticks and no gridlines, because
 * those belong to the one component that has an axis -- a frame owning them would have to
 * grow `ticks={false} grid={false}` for the heatmap, which is the first step toward a
 * component with eleven booleans. What is shared between a bar chart and a calendar grid is
 * the *semantics*, and that is all this holds.
 *
 * **Loading is handled here rather than by AsyncBoundary.** The boundary renders a centered
 * `<p>Loading…</p>`, which collapses a chart to a single line and makes the card jump when
 * the data lands. StatTile hit the same problem and solved it the same way, with its own
 * `loading` prop over a fixed-size placeholder: "a bar the width of a plausible number, so
 * the row does not resize when data lands."
 *
 * ⚠️ **The note is visible, not `.sr-only`.** Where a chart needs a caveat -- these bars
 * count appearances not people, this bucket is a partial week, this gap is not a pause --
 * the reader who needs it most is the one looking at the picture. A caveat only a screen
 * reader hears is a caveat the chart does not actually carry.
 *
 * ⚠️ **`interactiveMarks` trades one repetition for another.** A mark that wants a hover
 * card has to be focusable, and focusable content inside `aria-hidden` is an outright
 * fault -- unnamed, unannounced, but still in the tab order. So when it is set, the plot
 * drops `aria-hidden` for `role="group"` and an `aria-label` naming the caption, and every
 * value gets read twice in browse mode: once at the mark, once in the twin below. The twin
 * stays unconditional and authoritative either way -- this only changes whether the marks
 * are also readable, not whether the twin is.
 */
export function ChartFigure({ caption, loading, note, children, twin, interactiveMarks }: ChartFigureProps) {
  if (loading) {
    return <div className="chart-skeleton" aria-hidden="true" />
  }

  return (
    <figure className="chart">
      {/* The card header names the card; this names the figure, for anyone reading the
          twin below out of context. */}
      <figcaption className="sr-only">{caption}</figcaption>

      {/* aria-hidden rather than a convention nobody remembers: the marks carry nothing the
          twin does not, and hiding them mechanically stops a test -- or a screen reader --
          reaching into geometry that does not exist in jsdom and means nothing spoken.
          interactiveMarks charts are the exception -- see the docblock above. */}
      {interactiveMarks ? (
        <div className="chart-plot" role="group" aria-label={`${caption} — chart marks; the same values are in the table below`}>
          {children}
        </div>
      ) : (
        <div className="chart-plot" aria-hidden="true">
          {children}
        </div>
      )}

      {note && <p className="chart-note">{note}</p>}

      <div className="sr-only">{twin}</div>
    </figure>
  )
}
