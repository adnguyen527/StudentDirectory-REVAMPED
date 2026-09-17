// libraries & hooks
import { useSearchParams } from 'react-router-dom'
import { useApi } from '../../hooks/useApi'
// apis
import { listCenters } from '../../api/endpoints'
import type { CentersResponse } from '../../api/types'
// styles
import './Centers.css'

/**
 * Which centers the dashboard is answering for.
 *
 * Pills rather than the dropdown the list pages use: on those, the center is one filter
 * among five and belongs behind a button. Here it is the question the whole page answers,
 * so the selection is visible without a click and switching is one press.
 *
 * Multi-select, and several centers are combined into one set of figures rather than
 * compared side by side -- a manager over three centers is asking what their three come
 * to. `?center=` is repeated in the URL, the same spelling the API and every other page
 * uses, so a link to this page carries its selection and nothing has to translate.
 *
 * ⚠️ The names come from /api/centers rather than a list in this file. Four names written
 * into a component are silently wrong the day a fifth center opens.
 */
export function CenterBar() {
  const [params, setParams] = useSearchParams()
  const selected = params.getAll('center').filter(Boolean)

  const { data, loading, error } = useApi<CentersResponse>(
    (signal) => listCenters(signal),
    [],
  )

  const centers = data?.centers ?? []

  function select(next: string[]) {
    const updated = new URLSearchParams(params)
    updated.delete('center')
    for (const center of next) updated.append('center', center)
    // Each card keeps its own offset in component state and resets on this selection
    // changing; this clears the shared one the list pages write, so arriving here from a
    // filtered list does not start on a page that no longer exists.
    updated.delete('offset')
    setParams(updated)
  }

  function toggle(center: string) {
    select(
      selected.includes(center)
        ? selected.filter((name) => name !== center)
        : [...selected, center],
    )
  }

  // Not disabled and not a spinner: the bar keeps its height while the names load, so the
  // cards below do not jump down the page when they arrive.
  if (error) {
    return (
      <div className="state-error" role="alert">
        <strong>{error.status ? `Error ${error.status}` : 'Cannot reach the API'}</strong>
        {error.displayMessage}
      </div>
    )
  }

  return (
    <div className="center-bar" role="group" aria-label="Centers">
      <button
        type="button"
        className={selected.length === 0 ? 'center-pill center-pill-on' : 'center-pill'}
        aria-pressed={selected.length === 0}
        onClick={() => select([])}
      >
        All centers
      </button>
      {centers.map((center) => {
        const on = selected.includes(center)
        return (
          <button
            key={center}
            type="button"
            className={on ? 'center-pill center-pill-on' : 'center-pill'}
            aria-pressed={on}
            onClick={() => toggle(center)}
          >
            {center}
          </button>
        )
      })}
      {loading && centers.length === 0 && <span className="muted">Loading centers…</span>}
    </div>
  )
}
