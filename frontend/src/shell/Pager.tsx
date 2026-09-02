import { formatNumber } from '../api/bson'
import type { Page } from '../api/types'
import { ChevronIcon } from './Icons'
import './Pager.css'

interface PagerProps {
  page: Page
  /** Called with the new offset. The caller decides where that is stored. */
  onChange: (offset: number) => void
}

/**
 * Prev/next over the API's pagination envelope.
 *
 * It holds no page number of its own -- offset, limit and total come from the response,
 * so the pager cannot disagree with what was actually served. `total` counts every match
 * rather than this page, which is what makes the last-page check possible without
 * walking to the end.
 */
export function Pager({ page, onChange }: PagerProps) {
  const { limit, offset, total, returned } = page

  const first = total === 0 ? 0 : offset + 1
  const last = offset + returned
  const hasPrevious = offset > 0
  const hasNext = last < total

  // Controls only when there is somewhere to go. A pair of permanently disabled buttons
  // under a table that fits on one page is furniture, not an affordance -- and most cards
  // on a profile are in that state. The count stays either way: it is the card's own
  // total, and reading it does not depend on there being pages to turn.
  const hasPages = total > limit

  return (
    <nav className="pager" aria-label="Pagination">
      <span className="pager-status">
        {total === 0
          ? 'No results'
          : `${formatNumber(first)}–${formatNumber(last)} of ${formatNumber(total)}`}
      </span>

      {hasPages && (
        <div className="pager-buttons">
          <button
            type="button"
            className="button"
            disabled={!hasPrevious}
            // Clamped at zero: a short first page would otherwise send a negative offset,
            // which the API rejects with a 400.
            onClick={() => onChange(Math.max(0, offset - limit))}
          >
            <ChevronIcon className="pager-back" />
            Previous
          </button>
          <button
            type="button"
            className="button"
            disabled={!hasNext}
            onClick={() => onChange(offset + limit)}
          >
            Next
            <ChevronIcon />
          </button>
        </div>
      )}
    </nav>
  )
}
