import type { ReactNode } from 'react'

import './Chart.css'

interface ChartFigureProps {
  /** What the chart is, as a sentence fragment -- "Students by center". */
  caption: string
  /** Reserved-height placeholder while the data is in flight. */
  loading?: boolean
  /** What a dimmed mark or a gap means. Visible, not hidden -- see below. */
  note?: ReactNode
  /** The marks. Hidden from assistive tech; `twin` is the readable copy. */
  children: ReactNode
  /** The ChartTable carrying the same numbers. */
  twin: ReactNode
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
 */
export function ChartFigure({ caption, loading, note, children, twin }: ChartFigureProps) {
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
          reaching into geometry that does not exist in jsdom and means nothing spoken. */}
      <div className="chart-plot" aria-hidden="true">
        {children}
      </div>

      {note && <p className="chart-note">{note}</p>}

      <div className="sr-only">{twin}</div>
    </figure>
  )
}
