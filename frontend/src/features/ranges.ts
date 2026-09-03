import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'

/** Which suffix pair a column's bounds take -- routes/filtering.py, BOUNDS. */
export type RangeKind = 'number' | 'date'

export const SUFFIXES: Record<RangeKind, readonly [low: string, high: string]> = {
  number: ['_min', '_max'],
  date: ['_from', '_to'],
}

/** The filterable columns of one list, as the API declares them in FILTERABLE. */
export type RangeColumns = Record<string, RangeKind>

/**
 * Every range bound currently in the URL, ready to be handed to the API.
 *
 * The URL's names *are* the API's names, so this is a pass-through rather than a
 * translation -- which is the property that keeps a filtered list linkable: what is in
 * the address bar is exactly what was asked of the database.
 */
export function rangeParams(params: URLSearchParams, columns: RangeColumns) {
  const values: Record<string, string> = {}
  for (const [column, kind] of Object.entries(columns)) {
    for (const suffix of SUFFIXES[kind]) {
      const value = params.get(column + suffix)
      // A blank is a truncated URL rather than a bound, as the API also reads it.
      if (value) values[column + suffix] = value
    }
  }
  return values
}

/** A stable key for a dependency array -- an object literal is new every render. */
export function rangeKey(values: Record<string, string>) {
  return Object.entries(values)
    .map(([name, value]) => `${name}=${value}`)
    .sort()
    .join('&')
}

/**
 * What a range filter needs, wherever the bounds are kept -- as SortState, and for the
 * same reason: the same popover serves a list page backed by the URL and a profile card
 * backed by local state.
 */
export interface RangeState {
  low: string
  high: string
  active: boolean
  apply: (low: string, high: string) => void
}

/**
 * One column's bounds, read from and written to the URL.
 *
 * Writing both ends at once rather than one at a time: a range is a single edit, and
 * applying the min before the max is typed would fire a request for a range the user is
 * halfway through describing.
 */
export function useRange(column: string, kind: RangeKind): RangeState {
  const [params, setParams] = useSearchParams()
  const [lowSuffix, highSuffix] = SUFFIXES[kind]

  const low = params.get(column + lowSuffix) ?? ''
  const high = params.get(column + highSuffix) ?? ''

  function apply(nextLow: string, nextHigh: string) {
    const updated = new URLSearchParams(params)
    for (const [suffix, value] of [
      [lowSuffix, nextLow.trim()],
      [highSuffix, nextHigh.trim()],
    ] as const) {
      if (value) updated.set(column + suffix, value)
      else updated.delete(column + suffix)
    }
    // The offset goes with every filter -- page 3 of a narrower list is not page 3 of
    // the one you were reading.
    updated.delete('offset')
    setParams(updated)
  }

  return { low, high, active: low !== '' || high !== '', apply }
}


/**
 * The same bounds, kept in the component instead of the URL -- see useCardSort.
 *
 * Strings rather than numbers, so the two stores hand the popover exactly the same shape
 * and an empty box stays empty rather than becoming a zero.
 */
export function useCardRange(): RangeState {
  const [bounds, setBounds] = useState({ low: '', high: '' })

  return {
    low: bounds.low,
    high: bounds.high,
    active: bounds.low !== '' || bounds.high !== '',
    apply: (low: string, high: string) =>
      setBounds({ low: low.trim(), high: high.trim() }),
  }
}
