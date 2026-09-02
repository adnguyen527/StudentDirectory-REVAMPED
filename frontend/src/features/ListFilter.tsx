import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { SearchIcon } from '../shell/Icons'
import './ListFilter.css'

/** As GlobalSearch: long enough that typing does not fire a request per keystroke. */
const DEBOUNCE_MS = 250

interface ListFilterProps {
  /** What the box matches, in the user's terms -- the lists do not all match the same
   *  fields, so each page says its own. */
  placeholder: string
}

/**
 * A list page's own filter box, sitting where its card title used to be.
 *
 * Not the top-bar dropdown: that one answers students and instructors together and jumps
 * you somewhere, while this narrows the table you are already reading.
 *
 * The URL owns the term. That keeps a filtered list linkable and lets Back step through
 * filters, and it is why this component needs no props for state -- every page already
 * reads `query` out of the same place to build its request.
 */
export function ListFilter({ placeholder }: ListFilterProps) {
  const [params, setParams] = useSearchParams()
  const query = params.get('query') ?? ''

  // What is typed, before it becomes the URL's query. Seeded from the URL so arriving at
  // /topics?query=fractions shows the box already filled in.
  const [input, setInput] = useState(query)

  // The URL is the source of truth, so a Clear button or the back button has to be able
  // to overwrite what is in the box.
  useEffect(() => setInput(query), [query])

  useEffect(() => {
    const term = input.trim()
    if (term === query) return
    const timer = setTimeout(() => {
      const updated = new URLSearchParams(params)
      if (term) updated.set('query', term)
      else updated.delete('query')
      // The offset goes with the filter -- page 2 of the filtered list is not page 2 of
      // the whole, and keeping it lands the reader past the end of a short result.
      updated.delete('offset')
      setParams(updated, { replace: true })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // `params` and `setParams` change identity on every navigation; depending on them
    // would restart the timer mid-type.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [input, query])

  return (
    <div className="list-filter">
      <SearchIcon className="list-filter-icon" />
      <input
        type="search"
        className="list-filter-input"
        placeholder={placeholder}
        aria-label={placeholder}
        value={input}
        onChange={(event) => setInput(event.target.value)}
      />
    </div>
  )
}
