import { FilterPopover } from './FilterPopover'
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
 * The trigger and its dismissal are FilterPopover's, shared with the range filters in the
 * column headers. What is left here is the only thing that is actually about a list of
 * options: the summary, and toggling one.
 */
export function FilterDropdown({
  label,
  options,
  selected,
  onChange,
  emptyLabel,
  countNoun,
}: FilterDropdownProps) {
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
    <FilterPopover label={label} summary={summary} active={selected.length > 0}>
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
    </FilterPopover>
  )
}
