import { useEffect, useRef, useState, type ReactNode } from 'react'

import { ChevronIcon } from './Icons'
import './FilterDropdown.css'

interface FilterPopoverProps {
  /** Names the filter for a screen reader: "Filter by center", "Filter by sessions". */
  label: string
  /**
   * What this filter is currently doing, in words -- "All centers", "5 or more".
   *
   * Always the trigger's accessible name, and its visible text too unless `icon` replaces
   * it. A trigger that only names the column would leave a filtered list looking
   * unfiltered, which is the whole reason the lists grew a visible search box.
   */
  summary: string
  /** Whether this filter is narrowing the list, which the trigger has to show. */
  active: boolean
  /**
   * Renders in place of the summary text. The column headers use it: seven pills across
   * a header row would be a toolbar, so there the filter is a glyph and the summary is
   * carried by the accessible name and the trigger's own "on" state.
   */
  icon?: ReactNode
  className?: string
  children: ReactNode
}

/**
 * A filter behind one button: the trigger, the panel, and getting rid of the panel.
 *
 * Extracted from FilterDropdown when the second and third kinds of filter arrived. The
 * checkbox list, the number range and the date range differ only in what is inside the
 * panel; dismissal is the part that is easy to get subtly wrong and pointless to write
 * three times -- a panel that can only be closed by the button that opened it is a trap
 * once a header row holds seven of them.
 */
export function FilterPopover({
  label,
  summary,
  active,
  icon,
  className,
  children,
}: FilterPopoverProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Same dismissal as GlobalSearch: outside pointer-down, or Escape.
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

  const classes = ['filter-trigger']
  if (active) classes.push('filter-trigger-on')
  if (className) classes.push(className)

  return (
    <div className="filter-dropdown" ref={containerRef}>
      <button
        type="button"
        className={classes.join(' ')}
        aria-expanded={open}
        aria-label={`${label}: ${summary}`}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        {icon ?? (
          <>
            {summary}
            <ChevronIcon className="filter-trigger-caret" />
          </>
        )}
      </button>

      {open && (
        <div className="filter-panel" role="group" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  )
}
