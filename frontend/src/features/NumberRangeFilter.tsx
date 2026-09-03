import { useState } from 'react'

import { FunnelIcon } from '../shell/Icons'
import { FilterPopover } from '../shell/FilterPopover'
import { useRange, type RangeState } from './ranges'
import './ColumnFilter.css'

interface NumberRangeFilterProps {
  /** The column's name in the URL and in the API's FILTERABLE. */
  column: string
  /** How the column reads in a sentence: "sessions", "topics finished". */
  label: string
  /** A caveat the panel has to state -- see the median column on topics. */
  note?: string
  /**
   * Where the bounds are kept. Omitted on the list pages, which keep them in the URL and
   * send them to the API; supplied by a profile card, which filters rows it already has.
   */
  range?: RangeState
}

/** "Any", "5 or more", "up to 20", "5 to 20" -- what the trigger announces. */
function rangeSummary(low: string, high: string, label: string) {
  if (!low && !high) return `Any ${label}`
  if (low && !high) return `${low} or more ${label}`
  if (!low && high) return `Up to ${high} ${label}`
  return `${low} to ${high} ${label}`
}

/**
 * A minimum and a maximum on one count column.
 *
 * A range rather than a checkbox because on these columns a yes/no narrows nothing:
 * "has topics on plan" matches 822 of 893 students and "has unfinalized reports" 70 of
 * 103 instructors. What separates a straggler from a problem is a number.
 *
 * Both bounds are applied together, on submit rather than per keystroke: a range is one
 * edit, and firing at "1" on the way to "12" asks the database a question nobody asked.
 */
export function NumberRangeFilter({ column, label, note, range }: NumberRangeFilterProps) {
  // Always called, ignored when the caller brought its own -- see SortHeader.
  const urlRange = useRange(column, 'number')
  const { low, high, active, apply } = range ?? urlRange

  // Seeded from the URL and re-seeded when it changes, so an arrived-at filter shows its
  // own bounds and "Clear filters" empties the boxes. Adjusted during render rather than
  // in an effect: an effect would render once with the stale value and then again with
  // the right one, which is the cascade the lint rule is about.
  const [from, setFrom] = useState(low)
  const [to, setTo] = useState(high)
  const [seed, setSeed] = useState({ low, high })
  if (seed.low !== low || seed.high !== high) {
    setSeed({ low, high })
    setFrom(low)
    setTo(high)
  }

  return (
    <FilterPopover
      label={`Filter by ${label}`}
      summary={rangeSummary(low, high, label)}
      active={active}
      icon={<FunnelIcon />}
      className="column-filter-trigger"
    >
      <form
        className="column-filter"
        onSubmit={(event) => {
          event.preventDefault()
          apply(from, to)
        }}
      >
        <label className="column-filter-field">
          <span>Min</span>
          <input
            type="number"
            inputMode="numeric"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            aria-label={`Minimum ${label}`}
          />
        </label>
        <label className="column-filter-field">
          <span>Max</span>
          <input
            type="number"
            inputMode="numeric"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            aria-label={`Maximum ${label}`}
          />
        </label>

        {note && <p className="column-filter-note">{note}</p>}

        <div className="column-filter-actions">
          {/* Clearing is its own button rather than emptying two boxes and applying:
              undoing a filter should cost one click, as it does in the card header. */}
          {active && (
            <button type="button" className="button button-quiet" onClick={() => apply('', '')}>
              Clear
            </button>
          )}
          <button type="submit" className="button">
            Apply
          </button>
        </div>
      </form>
    </FilterPopover>
  )
}
