import { useSearchParams } from 'react-router-dom'

/**
 * The URL params that position the list rather than narrow it.
 *
 * Everything else in the URL is a filter, and that inversion is the point: a filter added
 * later -- a grade, a date range -- shows up in this button without touching this file,
 * while a new *view* control is a one-word addition here. Listing the filters instead
 * would put the burden on the wrong side, which is how ticking a center came to filter the
 * list with nothing on screen offering to undo it.
 */
const VIEW_PARAMS = new Set(['offset', 'sort', 'direction'])

/** The names of the params narrowing the list right now. */
function activeFilters(params: URLSearchParams) {
  const names = new Set<string>()
  params.forEach((value, name) => {
    // A blank value is a truncated URL, not a filter: the list routes ignore `?query=` and
    // `?center=` alike, so neither should light the button up or be worth clearing.
    if (!VIEW_PARAMS.has(name) && value !== '') names.add(name)
  })
  return [...names]
}

/**
 * The list pages' escape hatch, in the card header's right-hand slot.
 *
 * Renders nothing at all when the list is unfiltered -- the button is the only sign that
 * what you are reading is a subset, so it appearing has to mean exactly that.
 */
export function ClearFilters() {
  const [params, setParams] = useSearchParams()
  const active = activeFilters(params)

  function clear() {
    const updated = new URLSearchParams(params)
    for (const name of active) updated.delete(name)
    // The offset goes with the filters -- page 3 of a filtered list is not page 3 of the
    // whole one. Any other view param survives, which is why this is not a bare reset.
    updated.delete('offset')
    setParams(updated)
  }

  if (active.length === 0) return null

  return (
    <button type="button" className="button" onClick={clear}>
      {/* Singular while one filter is on: "Clear filters" beside a lone search term reads
          like there is something else set that you cannot see. */}
      {active.length === 1 ? 'Clear filter' : 'Clear filters'}
    </button>
  )
}
