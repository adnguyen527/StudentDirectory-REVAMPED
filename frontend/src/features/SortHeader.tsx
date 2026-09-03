import type { ReactNode } from 'react'

import { SortIcon } from '../shell/Icons'
import { useSort, type SortDirection, type SortState } from './useSort'
import './SortHeader.css'

interface ColumnHeaderProps {
  /**
   * The column's name in the URL and in the API's allowlist -- models/student.py's
   * SORTABLE and its two siblings. Null for a column that cannot be sorted: Center holds
   * an array of centers, so a row has no single value to be ordered by.
   */
  column?: string | null
  /**
   * Which way this column reads first. Counts and dates open largest-first -- most
   * sessions, most recent -- because that is the end anyone clicks the header to see.
   * Names open A-Z. The API defaults the same way per column, so a header and a
   * hand-written URL agree.
   */
  first?: SortDirection
  /** `numeric` on the count columns, as the tables already use. */
  className?: string
  /**
   * This column's filter, beside its sort control. Rendered only where the table is
   * interactive at all -- the same reason `sortable` exists.
   */
  filter?: ReactNode
  /**
   * Where this table's order is kept. Omitted on the list pages, which keep it in the
   * URL; supplied by a profile card, which keeps it in local state.
   */
  sort?: SortState
  children: ReactNode
}

/**
 * One sortable column heading.
 *
 * The whole cell is a button rather than a click handler on the <th>: a header you can
 * reach with Tab and fire with Enter is the same control for everyone, and the arrow
 * needs a focus ring to sit in.
 */
export function SortHeader({
  column,
  first = 'desc',
  className,
  filter,
  sort,
  children,
}: ColumnHeaderProps) {
  // Always called -- a hook cannot be conditional -- and ignored when the caller brought
  // its own store. Reading the URL costs nothing on a page that is not using it.
  const urlSort = useSort()
  const { activeDirection, toggle } = sort ?? urlSort
  const name = column as string
  const active = activeDirection(name, first)

  return (
    <th
      className={className}
      // The row's sorted state belongs on the cell, not the button: a screen reader
      // announces it while reading the column, which is when it is worth knowing.
      aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'}
    >
      <span className="column-head">
        <button
          type="button"
          className={active ? 'sort-button sort-button-on' : 'sort-button'}
          onClick={() => toggle(name, first)}
        >
          {children}
          <SortIcon className="sort-arrow" direction={active ?? undefined} />
        </button>
        {filter}
      </span>
    </th>
  )
}

/**
 * A heading that sorts, or a plain one that does not.
 *
 * Sorting is opt-in per table *usage*, not per table: the home page renders the same
 * StudentsTable as a fixed top-five card, and headers that reorder a five-row summary --
 * or worse, write ?sort= into the home page's URL -- would be a control that does not
 * mean anything there.
 */
export function ColumnHeader({
  sortable,
  column,
  first,
  className,
  filter,
  sort,
  children,
}: ColumnHeaderProps & { sortable?: boolean }) {
  if (!sortable) {
    return <th className={className}>{children}</th>
  }
  // A column can filter without sorting, or sort without filtering: Center is a
  // multi-select on an array with no single value to order by, and Account is the other
  // way round.
  if (!column) {
    return (
      <th className={className}>
        <span className="column-head">
          {children}
          {filter}
        </span>
      </th>
    )
  }
  return (
    <SortHeader
      column={column}
      first={first}
      className={className}
      filter={filter}
      sort={sort}
    >
      {children}
    </SortHeader>
  )
}
