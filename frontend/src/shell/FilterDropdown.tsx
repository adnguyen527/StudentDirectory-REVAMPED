import { useEffect, useRef, useState } from 'react'

import { ChevronIcon } from './Icons'
import './FilterDropdown.css'

interface FilterDropdownProps {
  /** Names the filter when nothing is chosen, and labels the trigger for a screen reader. */
  label: string
  options: string[]
  selected: string[]
  onChange: (selected: string[]) => void
  /** Trigger text when nothing is ticked -- "All centers" reads better than "Center". */
  emptyLabel: string
  /** Plural noun for the count, e.g. "centers" in "2 centers". */
  countNoun: string
}

/**
 * A multi-select filter behind one button.
 *
 * A dropdown rather than a row of checkboxes because the card header has to hold several
 * of these eventually and a search box beside them: each filter costs one button's width
 * this way, however many options it has.
 *
 * The trigger says what the closed panel is hiding. Without that a filtered list looks
 * unfiltered -- the whole reason the lists grew a visible search box in the first place.
 */
export function FilterDropdown({
  label,
  options,
  selected,
  onChange,
  emptyLabel,
  countNoun,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Same dismissal as GlobalSearch: a panel that can only be closed by the button that
  // opened it is a trap once there are several of them in a row.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function toggle(option: string) {
    onChange(
      selected.includes(option)
        ? selected.filter((name) => name !== option)
        : [...selected, option],
    )
  }

  const summary =
    selected.length === 0
      ? emptyLabel
      : selected.length === 1
        ? selected[0]
        : `${selected.length} ${countNoun}`

  return (
    <div className="filter-dropdown" ref={containerRef}>
      <button
        type="button"
        className={selected.length > 0 ? 'filter-trigger filter-trigger-on' : 'filter-trigger'}
        aria-expanded={open}
        aria-label={`${label}: ${summary}`}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        {summary}
        <ChevronIcon className="filter-trigger-caret" />
      </button>

      {open && (
        <div className="filter-panel" role="group" aria-label={label}>
          {options.length === 0 ? (
            <p className="filter-empty">Nothing to filter by.</p>
          ) : (
            options.map((option) => (
              <label key={option} className="filter-option">
                <input
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={() => toggle(option)}
                />
                {option}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  )
}
