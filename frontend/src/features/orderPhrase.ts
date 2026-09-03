import type { SortDirection } from './useSort'

/**
 * How one sortable column reads in a sentence, both ways round.
 *
 * `first` repeats what the table passes its header, and has to agree with it: it is what
 * resolves `?sort=sessions` with no direction, which the API also resolves per column.
 */
export interface OrderPhrase {
  first: SortDirection
  desc: string
  asc: string
}

/**
 * The list's order, said in words, for the line under the page title.
 *
 * It exists because that line already claimed an order -- "sorted by name" -- and a
 * sorted list turned the claim into a wrong one. The arrow in the header says which
 * column, but the sentence is what someone reads first, and a list that says it is in
 * name order while showing the busiest students is worse than one that says nothing.
 */
export function orderPhrase(
  phrases: Record<string, OrderPhrase>,
  resting: string,
  sort?: string,
  direction?: SortDirection,
) {
  if (!sort) return resting
  const phrase = phrases[sort]
  // An unknown column is a URL the API will refuse anyway; the error is the answer, not
  // a sentence about an order that was never applied.
  if (!phrase) return resting
  return (direction ?? phrase.first) === 'asc' ? phrase.asc : phrase.desc
}
