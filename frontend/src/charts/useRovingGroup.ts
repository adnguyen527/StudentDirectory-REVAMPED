import { useCallback, useRef, useState, type KeyboardEvent } from 'react'

export interface RovingGroupOptions {
  /** Total number of marks in the group, across every row if there is more than one. */
  count: number
  /**
   * A fixed-width 2-D grid -- the heatmap. Left/Right move by this many (a week), Up/Down
   * move by one (a day). Mutually exclusive with `rows`.
   */
  stride?: number
  /**
   * A ragged 2-D grid -- one length per row, in order. Left/Right walk the flat sequence
   * (marks stay in date order across a row boundary); Up/Down move to the same ordinal
   * position in the row above or below, clamped to that row's own length. Mutually
   * exclusive with `stride`.
   */
  rows?: readonly number[]
}

function rowOf(index: number, rows: readonly number[]): { row: number; offset: number } {
  let start = 0
  for (let row = 0; row < rows.length; row++) {
    const length = rows[row]
    if (index < start + length) return { row, offset: index - start }
    start += length
  }
  return { row: rows.length - 1, offset: 0 }
}

function rowStart(row: number, rows: readonly number[]): number {
  return rows.slice(0, row).reduce((sum, length) => sum + length, 0)
}

/**
 * Roving tabindex for a group of hover targets -- one tab stop for the whole chart, arrow
 * keys walk the marks, the hover card follows focus because focus is what opens it.
 *
 * Spread `itemProps(index)` inside the chart's existing `.map()`; nothing about the render
 * loop has to change shape.
 */
export function useRovingGroup({ count, stride, rows }: RovingGroupOptions) {
  const [active, setActive] = useState(0)
  const itemRefs = useRef<(HTMLElement | null)[]>([])

  const focusIndex = useCallback(
    (index: number) => {
      const clamped = Math.max(0, Math.min(count - 1, index))
      setActive(clamped)
      itemRefs.current[clamped]?.focus()
    },
    [count],
  )

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Home') {
        event.preventDefault()
        focusIndex(0)
        return
      }
      if (event.key === 'End') {
        event.preventDefault()
        focusIndex(count - 1)
        return
      }

      if (rows) {
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          focusIndex(active + 1)
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault()
          focusIndex(active - 1)
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          const { row, offset } = rowOf(active, rows)
          const targetRow = event.key === 'ArrowDown' ? row + 1 : row - 1
          if (targetRow < 0 || targetRow >= rows.length) return
          const targetLength = rows[targetRow]
          if (targetLength === 0) return
          focusIndex(rowStart(targetRow, rows) + Math.min(offset, targetLength - 1))
        }
        return
      }

      // A fixed grid moves by `stride` on the horizontal axis; a flat list has none, so
      // every arrow moves by one and the caller never has to pick an axis.
      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault()
          focusIndex(active + (stride ?? 1))
          break
        case 'ArrowLeft':
          event.preventDefault()
          focusIndex(active - (stride ?? 1))
          break
        case 'ArrowDown':
          event.preventDefault()
          focusIndex(active + 1)
          break
        case 'ArrowUp':
          event.preventDefault()
          focusIndex(active - 1)
          break
      }
    },
    [active, stride, rows, count, focusIndex],
  )

  function itemProps(index: number) {
    return {
      tabIndex: index === active ? 0 : -1,
      elementRef: (node: HTMLElement | null) => {
        itemRefs.current[index] = node
      },
      onFocus: () => setActive(index),
    }
  }

  return { groupProps: { onKeyDown }, itemProps }
}
