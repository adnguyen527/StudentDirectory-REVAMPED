import { useSearchParams } from 'react-router-dom'

/**
 * The URL param a chart's open state lives in.
 *
 * ⚠️ It must also appear in ClearFilters' VIEW_PARAMS, or the Clear button lights up for a
 * chart that narrows nothing and then wipes it. That file's own docstring anticipates this:
 * the set holds "the params that position the list rather than narrow it", and adding a new
 * view control there "is a one-word addition".
 */
export const CHART_PARAM = 'chart'

/**
 * Whether a chart is open, kept in the URL rather than in component state.
 *
 * The same choice `sort` and `direction` already make, and for the same reason the list
 * pages give for keeping their filters there: "a search result is linkable, and the
 * browser's Back button steps through pages instead of leaving the app". A chart someone
 * opened is part of what they would send a colleague.
 *
 * The param names the state rather than merely being present, because the two charts
 * disagree on their default -- the report volume opens on arrival and the centre charts do
 * not -- so an absent param has to mean "whatever this page defaults to".
 */
export function useChartToggle(openByDefault: boolean): [boolean, () => void] {
  const [params, setParams] = useSearchParams()

  const raw = params.get(CHART_PARAM)
  const open = raw === null ? openByDefault : raw === 'on'

  function toggle() {
    const updated = new URLSearchParams(params)
    const next = !open
    // Back to the default drops the param rather than spelling it out: a URL should not
    // carry state that changes nothing.
    if (next === openByDefault) updated.delete(CHART_PARAM)
    else updated.set(CHART_PARAM, next ? 'on' : 'off')
    setParams(updated)
  }

  return [open, toggle]
}
