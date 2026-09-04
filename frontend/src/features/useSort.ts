import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

export type SortDirection = 'asc' | 'desc'

/**
 * What a sortable header needs, wherever the order is actually kept.
 *
 * Two things keep one: the list pages keep it in the URL, and a card inside a profile
 * keeps it in local state. The header is the same control either way, so it takes this
 * rather than reaching for the URL itself.
 */
export interface SortState {
  column: string | null
  direction: SortDirection | null
  activeDirection: (name: string, first: SortDirection) => SortDirection | null
  toggle: (name: string, first: SortDirection) => void
}

/**
 * One step of the cycle: first -> reverse -> off.
 *
 * Shared so the two stores cannot drift into cycling differently, which would be the kind
 * of difference nobody notices until a header behaves oddly on one page.
 */
export function nextDirection(
  active: SortDirection | null,
  first: SortDirection,
): SortDirection | null {
  if (active === null) return first
  if (active === first) return first === 'asc' ? 'desc' : 'asc'
  return null
}

/**
 * The list order, held in the URL beside the filters and the page.
 *
 * Same reason as everything else that lives there: a sorted list is linkable, and Back
 * steps through orderings instead of leaving the app. The API reads the same two
 * parameters under the same names -- routes/sorting.py -- so what is in the address bar
 * is exactly what was asked of the database.
 */
export function useSort(): SortState {
  const [params, setParams] = useSearchParams()
  const column = params.get('sort')
  const direction = params.get('direction') as SortDirection | null

  /**
   * Which way this column is currently sorted, or null when it is not the sorted one.
   *
   * `?sort=sessions` with no direction is a legitimate URL -- the API resolves it to the
   * column's own default -- so the header has to resolve it the same way rather than
   * drawing no arrow.
   */
  function activeDirection(name: string, first: SortDirection): SortDirection | null {
    if (column !== name) return null
    return direction ?? first
  }

  /**
   * Advance one column through first -> reverse -> off.
   *
   * The third click clears both parameters and the list falls back to its resting order.
   * That state has to be reachable from the same button that left it, or a click made by
   * accident cannot be undone -- the name column is not always the resting order, so
   * "click Name to get back" is not an answer.
   */
  function toggle(name: string, first: SortDirection) {
    // Read from `previous` rather than from this render's params: two clicks landing in
    // the same tick would otherwise both see the unsorted URL and both ask for the first
    // direction, so an impatient double-click on a header would never reach the reverse.
    setParams((previous) => {
      const sorted = previous.get('sort') === name
      const active = sorted ? ((previous.get('direction') as SortDirection) ?? first) : null
      const next = nextDirection(active, first)
      const updated = new URLSearchParams(previous)

      if (next === null) {
        updated.delete('sort')
        updated.delete('direction')
      } else {
        updated.set('sort', name)
        updated.set('direction', next)
      }

      // The offset goes with the order, as it goes with the filters: page 3 of one
      // ordering is not page 3 of another, and the rows there are not the ones you left.
      updated.delete('offset')
      return updated
    })
  }

  return { column, direction, activeDirection, toggle }
}


/**
 * The same order, kept in the component instead of the URL.
 *
 * For a table inside a card rather than a page of its own: the student profile holds
 * three of them, so one `?sort=` between them would mean the last card clicked owns a
 * parameter the others also read. Prefixing per card would fix the collision and still
 * leave a linked URL restoring the order but not the page, since these cards page in
 * local state over rows the detail response already carried.
 */
export function useCardSort(): SortState {
  const [state, setState] = useState<{ column: string; direction: SortDirection } | null>(null)

  // `first` goes unread here, unlike the URL store: local state only ever holds an
  // explicit direction, so there is no "sorted, direction unstated" case to resolve.
  function activeDirection(name: string, _first: SortDirection): SortDirection | null {
    return state?.column === name ? state.direction : null
  }

  function toggle(name: string, first: SortDirection) {
    setState((previous) => {
      const active = previous?.column === name ? previous.direction : null
      const next = nextDirection(active, first)
      return next === null ? null : { column: name, direction: next }
    })
  }

  return {
    column: state?.column ?? null,
    direction: state?.direction ?? null,
    activeDirection,
    toggle,
  }
}
