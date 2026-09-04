import { useSearchParams } from 'react-router-dom'

import { listCenters } from '../api/endpoints'
import type { CentersResponse } from '../api/types'
import { useApi } from '../hooks/useApi'
import { FilterDropdown } from '../shell/FilterDropdown'

/**
 * The center filter on the two list pages, beside their search box.
 *
 * Several centers can be ticked and the result is a union. On students that union is also
 * a partition -- every student belongs to exactly one center -- but on instructors it is
 * not: 11 of 103 work at more than one, so ticking two returns fewer than the two counts
 * added together, and one instructor answers both boxes without being two people.
 *
 * The options come from the API rather than a constant here, so a fifth center appears in
 * the checkboxes without a release.
 */
export function CenterFilter() {
  const [params, setParams] = useSearchParams()
  const selected = params.getAll('center')

  const { data } = useApi<CentersResponse>((signal) => listCenters(signal), [])

  function choose(centers: string[]) {
    const updated = new URLSearchParams(params)
    updated.delete('center')
    for (const center of centers) updated.append('center', center)
    // The offset goes with the filter, as it does with the query -- page 2 of a filtered
    // list is not page 2 of the whole one.
    updated.delete('offset')
    setParams(updated)
  }

  return (
    <FilterDropdown
      label="Filter by center"
      options={data?.centers ?? []}
      selected={selected}
      onChange={choose}
      emptyLabel="All centers"
      countNoun="centers"
    />
  )
}
