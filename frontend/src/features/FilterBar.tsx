import type { ReactNode } from 'react'
// components
import { ClearFilters } from './ClearFilters'
// styles
import './ListFilter.css'

interface FilterBarProps {
  /** The filters themselves -- a search box, and whatever else this list narrows by. */
  children: ReactNode
}

/**
 * The row of filters a list page is read through, at page level rather than inside a card.
 *
 * ⚠️ **Where it sits is the whole point.** These controls scope two things -- the chart and
 * the table beneath it -- and they used to live in the *table's* card header, which put a
 * control inside one of the two cards it governs and below the other. Reading down the page
 * you met a chart, then the filters that had already shaped it. Lifting the row above both
 * says what is true: one row, and everything under it answers to it.
 *
 * A bare row rather than a card of its own, following `CenterBar` on the metrics page --
 * a page-level control is chrome for the page, not another panel competing with the
 * panels it scopes.
 *
 * No margin of its own: `.page` is a flex column with its own gap, so a sibling spaces
 * itself.
 */
export function FilterBar({ children }: FilterBarProps) {
  return (
    <div className="filter-bar" role="group" aria-label="Filters">
      {/* The same class the card header used, and for the same reason: `flex: 1` here is
          what gives the search box its slack and pushes Clear to the far end. */}
      <div className="list-controls">{children}</div>

      {/* Owned here rather than passed in by each page. Clear is not a filter -- it is the
          way out of them -- so it belongs at the row's end on every list without four
          callers each remembering to put it there. It renders nothing at all until
          something is actually set. */}
      <ClearFilters />
    </div>
  )
}
